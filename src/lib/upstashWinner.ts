import { getUpstashConfig, redisCommand } from "@/lib/upstash";
import { ORB_HISTORY_TTL_SECONDS } from "@/lib/orbLifecycle";

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

/** Atomic first-winner lock. Redis SET NX guarantees one winner across concurrent Vercel functions. */
export async function tryAcquireWinner(lockId: string, record: WinnerRecord): Promise<WinnerLockResult> {
  const credentials = getUpstashConfig();
  if (!credentials) return { configured: false, acquired: true, record };

  const result = await redisCommand<string>(["SET", winnerKey(lockId), JSON.stringify(record), "NX", "EX", ORB_HISTORY_TTL_SECONDS]);
  if (result === "OK") return { configured: true, acquired: true, record };

  const existing = await getWinner(lockId);
  return { configured: true, acquired: false, record: existing };
}

export async function getWinners(lockIds: string[]) {
  const unique = [...new Set(lockIds.filter(Boolean))];
  const winners = new Map<string, WinnerRecord>();
  if (!getUpstashConfig() || !unique.length) return winners;
  const raw = await redisCommand<Array<string | null>>(["MGET", ...unique.map(winnerKey)]);
  (raw || []).forEach((value, index) => {
    if (!value) return;
    try { winners.set(unique[index]!, JSON.parse(value) as WinnerRecord); } catch {}
  });
  return winners;
}

export async function getWinner(lockId: string): Promise<WinnerRecord | null> {
  if (!getUpstashConfig()) return null;
  const raw = await redisCommand<string>(["GET", winnerKey(lockId)]);
  if (!raw) return null;
  try { return JSON.parse(raw) as WinnerRecord; } catch { return null; }
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
  return updated;
}
