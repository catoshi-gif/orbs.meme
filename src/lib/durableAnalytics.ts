import "server-only";

import { redisCommand, upstashConfigured } from "@/lib/upstash";

const INDEX_KEY = "orbs:analytics:v1:funded";
const TOTALS_KEY = "orbs:analytics:v1:totals";
const FUNDED_INDEXED_KEY = "orbs:analytics:v1:indexed:funded";
const WINNER_INDEXED_KEY = "orbs:analytics:v1:indexed:winner";
const CLAIM_INDEXED_KEY = "orbs:analytics:v1:indexed:claim";
const orbKey = (slug: string) => `orbs:analytics:v1:orb:${slug}`;
const waitingDedupeKey = (slug: string) => `orbs:analytics:v1:dedupe:waiting:${slug}`;
const qualifiedDedupeKey = (slug: string) => `orbs:analytics:v1:dedupe:qualified:${slug}`;
const racerDedupeKey = (slug: string) => `orbs:analytics:v1:dedupe:racer:${slug}`;

export type FundedOrbAnalyticsSnapshot = {
  slug: string;
  orbId: string;
  createdAt: number;
  fundedAt: number;
  startsAt: number;
  endsAt: number;
  hostXUsername: string;
  tokenSymbol: string;
  prizeUsd: number;
  prizeTokenAmount: number;
  feeUsd: number;
  fundingTxSignature: string;
};

export type DurableOrbAnalytics = FundedOrbAnalyticsSnapshot & {
  waitingRoomVisitors: number;
  qualifiedEntries: number;
  liveRacers: number;
  hostSharePostId: string | null;
  winnerXUsername: string | null;
  winnerVerifiedElapsedMs: number | null;
  winnerVerifiedAt: string | null;
  claimedAt: string | null;
  claimTxSignature: string | null;
};

export type DurableAnalyticsTotals = {
  fundedOrbs: number;
  waitingRoomVisitors: number;
  qualifiedEntries: number;
  liveRacers: number;
  winners: number;
  claimedPrizes: number;
  totalWinnerPrizeUsdAtFunding: number;
  totalProtocolFeesUsdAtFunding: number;
};

function stringPairs(values: string[]) {
  const row: Record<string, string> = {};
  for (let i = 0; i + 1 < values.length; i += 2) row[values[i]!] = values[i + 1]!;
  return row;
}

function numberValue(value: string | undefined) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

function parseOrb(values: string[]): DurableOrbAnalytics | null {
  if (!values.length) return null;
  const row = stringPairs(values);
  if (!row.slug || !row.orbId) return null;
  return {
    slug: row.slug,
    orbId: row.orbId,
    createdAt: numberValue(row.createdAt),
    fundedAt: numberValue(row.fundedAt),
    startsAt: numberValue(row.startsAt),
    endsAt: numberValue(row.endsAt),
    hostXUsername: row.hostXUsername || "unknown",
    tokenSymbol: row.tokenSymbol || "SPL",
    prizeUsd: numberValue(row.prizeUsd),
    prizeTokenAmount: numberValue(row.prizeTokenAmount),
    feeUsd: numberValue(row.feeUsd),
    fundingTxSignature: row.fundingTxSignature || "",
    waitingRoomVisitors: Math.max(0, Math.trunc(numberValue(row.waitingRoomVisitors))),
    qualifiedEntries: Math.max(0, Math.trunc(numberValue(row.qualifiedEntries))),
    liveRacers: Math.max(0, Math.trunc(numberValue(row.liveRacers))),
    hostSharePostId: row.hostSharePostId || null,
    winnerXUsername: row.winnerXUsername || null,
    winnerVerifiedElapsedMs: row.winnerVerifiedElapsedMs ? numberValue(row.winnerVerifiedElapsedMs) : null,
    winnerVerifiedAt: row.winnerVerifiedAt || null,
    claimedAt: row.claimedAt || null,
    claimTxSignature: row.claimTxSignature || null,
  };
}

export async function recordFundedOrbAnalytics(snapshot: FundedOrbAnalyticsSnapshot) {
  if (!upstashConfigured()) return;
  await redisCommand<number>([
    "EVAL",
    `
      local added = redis.call('SADD', KEYS[1], ARGV[1])
      redis.call('HSET', KEYS[2],
        'slug', ARGV[2], 'orbId', ARGV[1], 'createdAt', ARGV[3],
        'startsAt', ARGV[5], 'endsAt', ARGV[6], 'hostXUsername', ARGV[7],
        'tokenSymbol', ARGV[8], 'prizeUsd', ARGV[9], 'prizeTokenAmount', ARGV[10],
        'feeUsd', ARGV[11], 'fundingTxSignature', ARGV[12])
      redis.call('HSETNX', KEYS[2], 'fundedAt', ARGV[4])
      redis.call('HSETNX', KEYS[2], 'waitingRoomVisitors', 0)
      redis.call('HSETNX', KEYS[2], 'qualifiedEntries', 0)
      redis.call('HSETNX', KEYS[2], 'liveRacers', 0)
      local funded_at = redis.call('HGET', KEYS[2], 'fundedAt') or ARGV[4]
      redis.call('ZADD', KEYS[3], funded_at, ARGV[2])
      if added == 1 then
        redis.call('HINCRBY', KEYS[4], 'fundedOrbs', 1)
        redis.call('HINCRBYFLOAT', KEYS[4], 'totalWinnerPrizeUsdAtFunding', ARGV[9])
        redis.call('HINCRBYFLOAT', KEYS[4], 'totalProtocolFeesUsdAtFunding', ARGV[11])
      end
      return added
    `,
    "4",
    FUNDED_INDEXED_KEY,
    orbKey(snapshot.slug),
    INDEX_KEY,
    TOTALS_KEY,
    snapshot.orbId,
    snapshot.slug,
    String(snapshot.createdAt),
    String(snapshot.fundedAt),
    String(snapshot.startsAt),
    String(snapshot.endsAt),
    snapshot.hostXUsername,
    snapshot.tokenSymbol,
    String(snapshot.prizeUsd),
    String(snapshot.prizeTokenAmount),
    String(snapshot.feeUsd),
    snapshot.fundingTxSignature,
  ]);
}

async function recordUniqueCounter(options: {
  slug: string;
  identity: string;
  field: "waitingRoomVisitors" | "qualifiedEntries" | "liveRacers";
  dedupeKey: string;
  ttlSeconds: number;
}) {
  if (!upstashConfigured()) return false;
  const result = await redisCommand<number>([
    "EVAL",
    `
      if redis.call('EXISTS', KEYS[2]) == 0 then return 0 end
      local added = redis.call('SADD', KEYS[1], ARGV[1])
      if added == 1 then
        redis.call('HINCRBY', KEYS[2], ARGV[2], 1)
        redis.call('HINCRBY', KEYS[3], ARGV[2], 1)
      end
      local ttl = redis.call('TTL', KEYS[1])
      if ttl < tonumber(ARGV[3]) then redis.call('EXPIRE', KEYS[1], ARGV[3]) end
      return added
    `,
    "3",
    options.dedupeKey,
    orbKey(options.slug),
    TOTALS_KEY,
    options.identity,
    options.field,
    String(Math.max(60, Math.floor(options.ttlSeconds))),
  ]);
  return result === 1;
}

export async function recordWaitingRoomVisitor(slug: string, visitorId: string, startsAt: number) {
  const remaining = startsAt - Date.now();
  if (remaining <= 0) return false;
  return recordUniqueCounter({
    slug,
    identity: visitorId,
    field: "waitingRoomVisitors",
    dedupeKey: waitingDedupeKey(slug),
    ttlSeconds: Math.ceil(remaining / 1000) + 24 * 60 * 60,
  });
}

export async function recordQualifiedEntryAnalytics(slug: string, identity: string, ttlSeconds: number) {
  return recordUniqueCounter({ slug, identity, field: "qualifiedEntries", dedupeKey: qualifiedDedupeKey(slug), ttlSeconds });
}

export async function recordLiveRacerAnalytics(slug: string, identity: string, ttlSeconds: number) {
  return recordUniqueCounter({ slug, identity, field: "liveRacers", dedupeKey: racerDedupeKey(slug), ttlSeconds });
}

export async function ensureAnalyticsCounterAtLeast(slug: string, field: "qualifiedEntries", minimum: number) {
  if (!upstashConfigured() || minimum <= 0) return;
  await redisCommand<number>([
    "EVAL",
    `
      if redis.call('EXISTS', KEYS[1]) == 0 then return 0 end
      local current = tonumber(redis.call('HGET', KEYS[1], ARGV[1]) or '0')
      local wanted = tonumber(ARGV[2])
      if wanted > current then
        local delta = wanted - current
        redis.call('HSET', KEYS[1], ARGV[1], wanted)
        redis.call('HINCRBY', KEYS[2], ARGV[1], delta)
        return delta
      end
      return 0
    `,
    "2",
    orbKey(slug),
    TOTALS_KEY,
    field,
    String(Math.max(0, Math.trunc(minimum))),
  ]);
}

export async function recordHostSharePostAnalytics(slug: string, postId: string) {
  if (!upstashConfigured()) return;
  await redisCommand<number>(["HSET", orbKey(slug), "hostSharePostId", postId]);
}

export async function recordWinnerAnalytics(options: { slug: string; orbId: string; xUsername?: string; verifiedElapsedMs: number; verifiedAt: string }) {
  if (!upstashConfigured()) return;
  await redisCommand<number>([
    "EVAL",
    `
      if redis.call('EXISTS', KEYS[2]) == 0 then return 0 end
      local added = redis.call('SADD', KEYS[1], ARGV[1])
      redis.call('HSET', KEYS[2], 'winnerXUsername', ARGV[2], 'winnerVerifiedElapsedMs', ARGV[3], 'winnerVerifiedAt', ARGV[4])
      if added == 1 then redis.call('HINCRBY', KEYS[3], 'winners', 1) end
      return added
    `,
    "3",
    WINNER_INDEXED_KEY,
    orbKey(options.slug),
    TOTALS_KEY,
    options.orbId,
    options.xUsername || "",
    String(options.verifiedElapsedMs),
    options.verifiedAt,
  ]);
}

export async function recordClaimAnalytics(options: { slug: string; orbId: string; claimTxSignature: string; claimedAt: string }) {
  if (!upstashConfigured()) return;
  await redisCommand<number>([
    "EVAL",
    `
      if redis.call('EXISTS', KEYS[2]) == 0 then return 0 end
      local added = redis.call('SADD', KEYS[1], ARGV[1])
      redis.call('HSET', KEYS[2], 'claimTxSignature', ARGV[2], 'claimedAt', ARGV[3])
      if added == 1 then redis.call('HINCRBY', KEYS[3], 'claimedPrizes', 1) end
      return added
    `,
    "3",
    CLAIM_INDEXED_KEY,
    orbKey(options.slug),
    TOTALS_KEY,
    options.orbId,
    options.claimTxSignature,
    options.claimedAt,
  ]);
}

async function readAnalyticsRange(start: number, end: number) {
  if (!upstashConfigured()) return [] as DurableOrbAnalytics[];
  const raw = await redisCommand<unknown[]>([
    "EVAL",
    `
      local slugs = redis.call('ZREVRANGE', KEYS[1], ARGV[1], ARGV[2])
      local out = {}
      for _, slug in ipairs(slugs) do
        table.insert(out, slug)
        table.insert(out, redis.call('HGETALL', 'orbs:analytics:v1:orb:' .. slug))
      end
      return out
    `,
    "1",
    INDEX_KEY,
    String(start),
    String(end),
  ]);
  const rows: DurableOrbAnalytics[] = [];
  for (let i = 0; raw && i + 1 < raw.length; i += 2) {
    const values = raw[i + 1];
    if (!Array.isArray(values)) continue;
    const parsed = parseOrb(values.map((value) => String(value)));
    if (parsed) rows.push(parsed);
  }
  return rows;
}

export async function getDurableOrbAnalytics(limit = 500) {
  const max = Math.max(1, Math.min(10_000, Math.trunc(limit)));
  return readAnalyticsRange(0, max - 1);
}

export async function getAllDurableOrbAnalytics() {
  if (!upstashConfigured()) return [] as DurableOrbAnalytics[];
  const count = Number(await redisCommand<number>(["ZCARD", INDEX_KEY]) || 0);
  const rows: DurableOrbAnalytics[] = [];
  for (let start = 0; start < count; start += 500) {
    rows.push(...await readAnalyticsRange(start, Math.min(count - 1, start + 499)));
  }
  return rows;
}

export async function getDurableAnalyticsTotals(): Promise<DurableAnalyticsTotals> {
  const raw = await redisCommand<string[]>(["HGETALL", TOTALS_KEY]);
  const row = stringPairs(raw || []);
  return {
    fundedOrbs: Math.trunc(numberValue(row.fundedOrbs)),
    waitingRoomVisitors: Math.trunc(numberValue(row.waitingRoomVisitors)),
    qualifiedEntries: Math.trunc(numberValue(row.qualifiedEntries)),
    liveRacers: Math.trunc(numberValue(row.liveRacers)),
    winners: Math.trunc(numberValue(row.winners)),
    claimedPrizes: Math.trunc(numberValue(row.claimedPrizes)),
    totalWinnerPrizeUsdAtFunding: numberValue(row.totalWinnerPrizeUsdAtFunding),
    totalProtocolFeesUsdAtFunding: numberValue(row.totalProtocolFeesUsdAtFunding),
  };
}
