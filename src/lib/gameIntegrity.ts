import "server-only";

import { randomUUID } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import { redisCommand } from "@/lib/upstash";

const BAN_TTL_SECONDS = 60 * 60 * 24 * 365 * 5;
const TELEMETRY_TTL_SECONDS = 60 * 60 * 24 * 14;
const BAN_INDEX = "orbs:v1:integrity:bans";
const TELEMETRY_INDEX = "orbs:v1:integrity:telemetry:index";

const walletBanKey = (wallet: string) => `orbs:v1:integrity:ban:wallet:${wallet}`;
const xBanKey = (xUserId: string) => `orbs:v1:integrity:ban:x:${xUserId}`;
const banRecordKey = (id: string) => `orbs:v1:integrity:ban:record:${id}`;
const telemetryKey = (matchId: string, wallet: string) => `orbs:v1:integrity:telemetry:${matchId}:${wallet}`;

export const COMPETITION_RESTRICTION_MESSAGE = "This account has been restricted from Orbs competitions due to suspicious automated gameplay or a fair-play policy violation.";

export type CompetitionRestriction = {
  id: string;
  wallet: string | null;
  xUserId: string | null;
  username: string | null;
  reason: string;
  createdAt: number;
  createdBy: string;
  active: true;
};

export type ArenaIntegrityTelemetry = {
  schemaVersion: 1;
  game?: "arena" | "race";
  version: string;
  matchId: string;
  orbId: string;
  slug: string;
  sampledAt: number;
  phase: string;
  playerId: string;
  wallet: string;
  xUserId: string;
  username: string;
  followersCount: number | null;
  ipHash: string | null;
  sameIpPeers: number;
  alive: boolean;
  health: number;
  score: number;
  level: "normal" | "watch" | "high";
  signals: string[];
  movementPatternScore: number;
  positionLoopScore: number;
  actionRegularityScore: number;
  recoveryZoneShare: number;
  recoveryPickups: number;
  blockedPickupAttempts: number;
  actions: number;
  inputSamples: number;
  positionSamples: number;
};

function normalizeWallet(wallet: string | null | undefined) {
  if (!wallet) return null;
  try { return new PublicKey(wallet).toBase58(); } catch { return null; }
}

function parseRestriction(raw: string | null) {
  if (!raw) return null;
  try {
    const record = JSON.parse(raw) as CompetitionRestriction;
    return record?.active === true ? record : null;
  } catch { return null; }
}

export async function getCompetitionRestriction(walletInput: string | null | undefined, xUserId: string | null | undefined) {
  const wallet = normalizeWallet(walletInput);
  const xId = String(xUserId || "").trim() || null;
  const keys = [wallet ? walletBanKey(wallet) : null, xId ? xBanKey(xId) : null].filter(Boolean) as string[];
  if (!keys.length) return null;
  const values = await redisCommand<Array<string | null>>(["MGET", ...keys]).catch(() => null);
  if (!values) return null;
  for (const raw of values) {
    const record = parseRestriction(raw);
    if (record) return record;
  }
  return null;
}

export async function banCompetitionIdentity(input: {
  wallet?: string | null;
  xUserId?: string | null;
  username?: string | null;
  reason?: string | null;
  createdBy: string;
}) {
  const wallet = normalizeWallet(input.wallet);
  const xUserId = String(input.xUserId || "").trim() || null;
  if (!wallet && !xUserId) throw new Error("A wallet or X user ID is required");
  const record: CompetitionRestriction = {
    id: randomUUID(),
    wallet,
    xUserId,
    username: String(input.username || "").trim().slice(0, 64) || null,
    reason: String(input.reason || "Suspicious automated gameplay / fair-play policy violation").trim().slice(0, 240),
    createdAt: Date.now(),
    createdBy: input.createdBy,
    active: true,
  };
  const mappings = [wallet ? walletBanKey(wallet) : null, xUserId ? xBanKey(xUserId) : null].filter(Boolean) as string[];
  const result = await redisCommand<number>(["EVAL", `
    redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2])
    for i=2,#KEYS do redis.call('SET', KEYS[i], ARGV[1], 'EX', ARGV[2]) end
    redis.call('ZADD', ARGV[3], ARGV[4], ARGV[5])
    return 1
  `, String(1 + mappings.length), banRecordKey(record.id), ...mappings, JSON.stringify(record), BAN_TTL_SECONDS, BAN_INDEX, record.createdAt, record.id]);
  if (result !== 1) throw new Error("Could not persist competition restriction");
  return record;
}

export async function unbanCompetitionIdentity(record: Pick<CompetitionRestriction, "id" | "wallet" | "xUserId">) {
  const keys = [banRecordKey(record.id), record.wallet ? walletBanKey(record.wallet) : null, record.xUserId ? xBanKey(record.xUserId) : null].filter(Boolean) as string[];
  await redisCommand<number>(["EVAL", `
    redis.call('DEL', KEYS[1])
    for i=2,#KEYS do
      local raw = redis.call('GET', KEYS[i])
      if raw then
        local ok, decoded = pcall(cjson.decode, raw)
        if ok and decoded and decoded['id'] == ARGV[2] then redis.call('DEL', KEYS[i]) end
      end
    end
    redis.call('ZREM', ARGV[1], ARGV[2])
    return 1
  `, String(keys.length), ...keys, BAN_INDEX, record.id]);
}

export async function listCompetitionRestrictions(limit = 100) {
  const ids = await redisCommand<string[]>(["ZREVRANGE", BAN_INDEX, 0, Math.max(0, Math.min(499, limit - 1))]) || [];
  if (!ids.length) return [] as CompetitionRestriction[];
  const raws = await redisCommand<Array<string | null>>(["MGET", ...ids.map(banRecordKey)]) || [];
  return raws.map(parseRestriction).filter((v): v is CompetitionRestriction => Boolean(v));
}

export async function storeArenaIntegrityTelemetry(rows: ArenaIntegrityTelemetry[]) {
  const cleaned = rows.filter((row) => row?.schemaVersion === 1 && row.matchId && normalizeWallet(row.wallet) && row.xUserId).slice(0, 200);
  if (!cleaned.length) return 0;
  const now = Date.now();
  const args: Array<string | number> = [TELEMETRY_INDEX, TELEMETRY_TTL_SECONDS, now - TELEMETRY_TTL_SECONDS * 1000];
  const keys: string[] = [];
  for (const row of cleaned) {
    const wallet = normalizeWallet(row.wallet)!;
    const normalized = { ...row, wallet, sampledAt: Math.min(now + 60_000, Math.max(0, Number(row.sampledAt) || now)) };
    const key = telemetryKey(normalized.matchId, wallet);
    keys.push(key);
    args.push(key, normalized.sampledAt, JSON.stringify(normalized));
  }
  const result = await redisCommand<number>(["EVAL", `
    local index = ARGV[1]
    local ttl = tonumber(ARGV[2])
    local cutoff = tonumber(ARGV[3])
    local ai = 4
    for i=1,#KEYS do
      local key = ARGV[ai]
      local score = ARGV[ai+1]
      local body = ARGV[ai+2]
      redis.call('SET', key, body, 'EX', ttl)
      redis.call('ZADD', index, score, key)
      ai = ai + 3
    end
    redis.call('ZREMRANGEBYSCORE', index, '-inf', cutoff)
    return #KEYS
  `, String(keys.length), ...keys, ...args]);
  return result || 0;
}

export async function listArenaIntegrityTelemetry(limit = 120) {
  const keys = await redisCommand<string[]>(["ZREVRANGE", TELEMETRY_INDEX, 0, Math.max(0, Math.min(499, limit - 1))]) || [];
  if (!keys.length) return [] as ArenaIntegrityTelemetry[];
  const raws = await redisCommand<Array<string | null>>(["MGET", ...keys]) || [];
  const rows: ArenaIntegrityTelemetry[] = [];
  for (const raw of raws) {
    if (!raw) continue;
    try {
      const row = JSON.parse(raw) as ArenaIntegrityTelemetry;
      if (row?.schemaVersion === 1) rows.push(row);
    } catch {}
  }
  return rows;
}
