import { getUpstashConfig, redisCommand } from "@/lib/upstash";
import { ORB_HISTORY_TTL_SECONDS } from "@/lib/orbLifecycle";
import { recordClaimAnalytics, recordWinnerAnalytics } from "@/lib/durableAnalytics";

export type WinnerRecord = {
  slug: string;
  orbId?: string;
  replayId: string;
  manifestHash: string;
  replayHash: string;
  verifiedElapsedMs: number;
  verifiedAt: string;
  wallet?: string;
  xUserId?: string;
  xUsername?: string;
  claimTxSignature?: string;
  claimedAt?: string;
};

export type WinnerLockResult =
  | { configured: false; acquired: true; record: WinnerRecord }
  | { configured: true; acquired: true; record: WinnerRecord }
  | { configured: true; acquired: false; record: WinnerRecord | null };

export function winnerKey(lockId: string) {
  return `orbs:v1:winner:${lockId}`;
}

const winnerLeaderboardKey = "orbs:v1:leaderboard:wins";
const winnerProfileKey = "orbs:v1:leaderboard:x-profiles";
const winnerLeaderboardIndexedKey = "orbs:v1:leaderboard:indexed-winners";
const winnerLeaderboardMigrationKey = "orbs:v1:leaderboard:migrated-v1";

export type LeaderboardEntry = {
  rank: number;
  wins: number;
  xUserId: string;
  xUsername: string;
};

/** Atomic first-winner lock. Redis SET NX guarantees one winner across concurrent Vercel functions. */
export async function tryAcquireWinner(lockId: string, record: WinnerRecord): Promise<WinnerLockResult> {
  const credentials = getUpstashConfig();
  if (!credentials) return { configured: false, acquired: true, record };

  const result = await redisCommand<string>(["SET", winnerKey(lockId), JSON.stringify(record), "NX", "EX", ORB_HISTORY_TTL_SECONDS]);
  if (result === "OK") {
    try { await indexWinnerForLeaderboard(lockId, record); }
    catch (error) { console.warn("[orbs:leaderboard] winner was secured but leaderboard indexing will retry later", error); }
    if (record.orbId) {
      await recordWinnerAnalytics({
        slug: record.slug, orbId: record.orbId, xUsername: record.xUsername,
        verifiedElapsedMs: record.verifiedElapsedMs, verifiedAt: record.verifiedAt,
      }).catch((error) => console.warn("[orbs:analytics] winner snapshot failed", error));
    }
    return { configured: true, acquired: true, record };
  }

  const existing = await getWinner(lockId);
  return { configured: true, acquired: false, record: existing };
}

export async function getWinners(lockIds: string[]) {
  const unique = [...new Set(lockIds.filter(Boolean))];
  const winners = new Map<string, WinnerRecord>();
  if (!getUpstashConfig() || !unique.length) return winners;
  const raw = await redisCommand<Array<string | null>>(["MGET", ...unique.map(winnerKey)]);
  const backfills: Array<Promise<void>> = [];
  (raw || []).forEach((value, index) => {
    if (!value) return;
    try {
      const record = JSON.parse(value) as WinnerRecord;
      const lockId = unique[index]!;
      winners.set(lockId, record);
      backfills.push(indexWinnerForLeaderboard(lockId, record).catch(() => undefined));
    } catch {}
  });
  await Promise.all(backfills);
  return winners;
}

export async function getWinner(lockId: string): Promise<WinnerRecord | null> {
  if (!getUpstashConfig()) return null;
  const raw = await redisCommand<string>(["GET", winnerKey(lockId)]);
  if (!raw) return null;
  try {
    const record = JSON.parse(raw) as WinnerRecord;
    await indexWinnerForLeaderboard(lockId, record).catch(() => undefined);
    return record;
  } catch { return null; }
}

export function winnerStoreConfigured() {
  return Boolean(getUpstashConfig());
}

export async function markWinnerClaimed(lockId: string, wallet: string, signature: string) {
  const current = await getWinner(lockId);
  if (!current || current.wallet !== wallet) throw new Error("Winner record does not match this wallet");
  if (current.claimTxSignature) {
    if (current.claimTxSignature !== signature) throw new Error("Winner record is already bound to another claim transaction");
    return current;
  }
  const updated: WinnerRecord = { ...current, claimTxSignature: signature, claimedAt: new Date().toISOString() };
  await redisCommand<string>(["SET", winnerKey(lockId), JSON.stringify(updated), "EX", ORB_HISTORY_TTL_SECONDS]);
  if (updated.orbId && updated.claimedAt) {
    await recordClaimAnalytics({ slug: updated.slug, orbId: updated.orbId, claimTxSignature: signature, claimedAt: updated.claimedAt })
      .catch((error) => console.warn("[orbs:analytics] claim snapshot failed", error));
  }
  return updated;
}

async function indexWinnerForLeaderboard(lockId: string, record: WinnerRecord) {
  if (!record.xUserId || !record.xUsername || !getUpstashConfig()) return;
  await redisCommand<number>([
    "EVAL",
    `
      local added = redis.call('SADD', KEYS[1], ARGV[1])
      if added == 1 then redis.call('ZINCRBY', KEYS[2], 1, ARGV[2]) end
      redis.call('HSET', KEYS[3], ARGV[2], ARGV[3])
      return added
    `,
    "3",
    winnerLeaderboardIndexedKey,
    winnerLeaderboardKey,
    winnerProfileKey,
    lockId,
    record.xUserId,
    record.xUsername,
  ]);
}

async function ensureWinnerLeaderboardBackfill() {
  if (!getUpstashConfig()) return;
  const migrated = await redisCommand<string>(["GET", winnerLeaderboardMigrationKey]);
  if (migrated === "1") return;
  let cursor = "0";
  let passes = 0;
  do {
    const scan = await redisCommand<[string, string[]]>(["SCAN", cursor, "MATCH", "orbs:v1:winner:*", "COUNT", "200"]);
    if (!scan) break;
    cursor = String(scan[0] || "0");
    const keys = scan[1] || [];
    if (keys.length) {
      const raw = await redisCommand<Array<string | null>>(["MGET", ...keys]);
      for (let i = 0; i < keys.length; i += 1) {
        const value = raw?.[i];
        if (!value) continue;
        try {
          const record = JSON.parse(value) as WinnerRecord;
          const lockId = keys[i]!.slice("orbs:v1:winner:".length);
          await indexWinnerForLeaderboard(lockId, record);
        } catch {}
      }
    }
    passes += 1;
  } while (cursor !== "0" && passes < 20);
  if (cursor === "0") await redisCommand<string>(["SET", winnerLeaderboardMigrationKey, "1"]);
}

export async function getWinnerLeaderboard(limit = 10): Promise<LeaderboardEntry[]> {
  if (!getUpstashConfig()) return [];
  await ensureWinnerLeaderboardBackfill();
  const max = Math.max(1, Math.min(100, Math.trunc(limit)));
  const rows = await redisCommand<string[]>(["ZREVRANGE", winnerLeaderboardKey, "0", String(max - 1), "WITHSCORES"]);
  if (!rows?.length) return [];
  const ids: string[] = [];
  const wins: number[] = [];
  for (let i = 0; i + 1 < rows.length; i += 2) {
    ids.push(rows[i]!);
    wins.push(Math.max(0, Math.trunc(Number(rows[i + 1] || 0))));
  }
  const usernames = ids.length ? await redisCommand<Array<string | null>>(["HMGET", winnerProfileKey, ...ids]) : [];
  return ids.map((xUserId, index) => ({
    rank: index + 1,
    wins: wins[index] || 0,
    xUserId,
    xUsername: usernames?.[index] || "unknown",
  }));
}
