import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { buildGameCommitment, hashCanonicalManifest, sha256Hex } from "@/game/canonical";
import { GAME_GENERATOR_VERSION, GAME_PHYSICS_VERSION, RAPIER_VERSION } from "@/game/constants";
import { generateGameManifestFromSecret } from "@/game/maze";
import type { DifficultyKey, GameManifest, GameStyle } from "@/game/types";
import type { WalletSplToken } from "@/lib/walletTokens";
import { MIN_PRIZE_USD, ORBS_FEE_USD, rawToTokenNumber } from "@/lib/prizeEconomics";
import type { XProfile } from "@/lib/xAuth";
import { redisCommand, redisGetJson, upstashConfigured } from "@/lib/upstash";
import { activeHostedOrbKey, enteredOrbsKey, isAdminWallet, ORB_COMPETITION_WINDOW_MS, ORB_HISTORY_TTL_SECONDS, orbEndsAt } from "@/lib/orbLifecycle";
import { getWinner, getWinners } from "@/lib/upstashWinner";

export type OrbTokenSnapshot = Pick<WalletSplToken, "mint" | "symbol" | "name" | "decimals" | "logoURI" | "usdPrice">;

export type OrbRecord = {
  schemaVersion: 1;
  id: string;
  slug: string;
  createdAt: number;
  startsAt: number;
  endsAt?: number;
  status: "scheduled-test" | "live-test" | "won-test";
  hostWallet: string;
  hostX: XProfile;
  difficulty: DifficultyKey;
  style: GameStyle;
  token: OrbTokenSnapshot;
  prizeTokenAmount: number;
  prizeRawAmount: string;
  prizeUsd: number;
  feeUsd: number;
  feeTokenAmount: number;
  feeRawAmount: string;
  priceQuotedAt: number;
  generatorVersion: string;
  physicsVersion: string;
  rapierVersion: string;
  settingsHash: string;
  commitment: string;
  encryptedSecretSeed: string;
};

export type PublicOrbRecord = Omit<OrbRecord, "encryptedSecretSeed" | "endsAt"> & { endsAt: number };

const orbKey = (slug: string) => `orbs:v1:orb:${slug}`;
const hostedOrbsKey = (wallet: string) => `orbs:v1:hosted:${wallet}`;

function gameSecret() {
  const value = (process.env.ORBS_GAME_SECRET_KEY || "").trim();
  if (value.length < 24) throw new Error("ORBS_GAME_SECRET_KEY must be a long random secret");
  return createHash("sha256").update(value).digest();
}

function encryptSeed(seedHex: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", gameSecret(), iv);
  const encrypted = Buffer.concat([cipher.update(seedHex, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64url");
}

function decryptSeed(payload: string) {
  const raw = Buffer.from(payload, "base64url");
  if (raw.length < 29) throw new Error("Invalid encrypted Orb seed");
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const encrypted = raw.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", gameSecret(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

function cleanStyle(style: GameStyle): GameStyle {
  const color = (value: string) => /^#[0-9A-Fa-f]{6}$/.test(value) ? value.toUpperCase() : "#5B5CF6";
  return { marble: color(style.marble), marbleSecondary: color(style.marbleSecondary), walls: color(style.walls), floor: color(style.floor), accent: color(style.accent) };
}

function publicRecord(record: OrbRecord): PublicOrbRecord {
  const { encryptedSecretSeed: _secret, endsAt: _storedEndsAt, ...safe } = record;
  return { ...safe, endsAt: orbEndsAt(record) };
}

async function releaseActiveLock(wallet: string, slug: string) {
  await redisCommand<number>([
    "EVAL",
    "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end; return 0",
    "1",
    activeHostedOrbKey(wallet),
    slug,
  ]);
}

export async function releaseActiveHostedOrb(wallet: string, slug: string) {
  if (!upstashConfigured() || isAdminWallet(wallet)) return;
  await releaseActiveLock(wallet, slug);
}

export async function getActiveHostedOrb(wallet: string): Promise<PublicOrbRecord | null> {
  if (!upstashConfigured() || isAdminWallet(wallet)) return null;
  const slug = await redisCommand<string>(["GET", activeHostedOrbKey(wallet)]);
  if (!slug) {
    // Backfill the lock for Orbs created before the one-active rule shipped.
    // This runs only on creator/dashboard policy checks and keeps deployment migration DB-light.
    const hosted = await listHostedOrbs(wallet, 100);
    const winners = await getWinners(hosted.map((orb) => orb.id));
    const legacyActive = hosted.find((orb) => Date.now() < orbEndsAt(orb) && !winners.has(orb.id));
    if (!legacyActive) return null;
    const ttl = Math.max(60, Math.ceil((orbEndsAt(legacyActive) - Date.now()) / 1000));
    const stored = await redisCommand<string>(["SET", activeHostedOrbKey(wallet), legacyActive.slug, "NX", "EX", ttl]);
    if (stored === "OK") return legacyActive;
    const competingLock = await redisCommand<string>(["GET", activeHostedOrbKey(wallet)]);
    if (!competingLock) throw new Error("Could not reserve this wallet's active Orb policy");
    return getActiveHostedOrb(wallet);
  }
  const record = await getOrbRecord(slug);
  if (!record) {
    await releaseActiveLock(wallet, slug);
    return null;
  }
  const winner = await getWinner(record.id);
  if (winner || Date.now() >= orbEndsAt(record)) {
    await releaseActiveLock(wallet, slug);
    return null;
  }
  return publicRecord(record);
}

export function orbStoreConfigured() {
  return upstashConfigured() && Boolean((process.env.ORBS_GAME_SECRET_KEY || "").trim());
}

export async function createTestOrb(input: {
  hostWallet: string;
  hostX: XProfile;
  difficulty: DifficultyKey;
  style: GameStyle;
  token: WalletSplToken;
  prizeTokenAmount: number;
  prizeRawAmount: string;
  quotedUsdPrice: number;
  feeRawAmount: string;
  priceQuotedAt: number;
  startsAt: number;
}) {
  if (!orbStoreConfigured()) throw new Error("Orb storage is not configured");
  if (input.hostX.protected) throw new Error("Orb hosts must use a public X account so players can follow immediately");
  if (!input.token.eligible) throw new Error(input.token.ineligibleReason || "Selected token is not fundable");
  if (!Number.isFinite(input.prizeTokenAmount) || input.prizeTokenAmount <= 0 || !/^\d+$/.test(input.prizeRawAmount)) throw new Error("Invalid prize amount");
  if (!Number.isFinite(input.quotedUsdPrice) || input.quotedUsdPrice <= 0 || !/^\d+$/.test(input.feeRawAmount)) throw new Error("Invalid funding quote");
  const prizeUsd = input.prizeTokenAmount * input.quotedUsdPrice;
  if (prizeUsd < MIN_PRIZE_USD) throw new Error(`Prize must be at least $${MIN_PRIZE_USD.toFixed(2)}`);
  const feeTokenAmount = rawToTokenNumber(input.feeRawAmount, input.token.decimals);
  const requiredRaw = BigInt(input.prizeRawAmount) + BigInt(input.feeRawAmount);
  if (requiredRaw > BigInt(input.token.rawAmount)) throw new Error(`Wallet balance does not cover the prize plus the $${ORBS_FEE_USD.toFixed(2)} Orbs fee`);
  if (!Number.isFinite(input.startsAt) || input.startsAt < Date.now() + 30_000) throw new Error("Launch must be at least 30 seconds in the future");
  if (input.startsAt > Date.now() + 1000 * 60 * 60 * 24 * 30) throw new Error("Launch must be within 30 days");

  const id = randomBytes(16).toString("hex");
  let slug = randomBytes(6).toString("base64url");
  while (await redisGetJson<OrbRecord>(orbKey(slug))) slug = randomBytes(6).toString("base64url");
  const style = cleanStyle(input.style);
  const settingsHash = await sha256Hex(JSON.stringify({
    hostWallet: input.hostWallet,
    hostXId: input.hostX.id,
    difficulty: input.difficulty,
    style,
    tokenMint: input.token.mint,
    prizeTokenAmount: input.prizeTokenAmount,
    prizeRawAmount: input.prizeRawAmount,
    prizeUsd,
    feeUsd: ORBS_FEE_USD,
    feeTokenAmount,
    feeRawAmount: input.feeRawAmount,
    tokenPriceUsd: input.quotedUsdPrice,
    priceQuotedAt: input.priceQuotedAt,
    startsAt: input.startsAt,
    generatorVersion: GAME_GENERATOR_VERSION,
    physicsVersion: GAME_PHYSICS_VERSION,
  }));
  const secretSeedHex = randomBytes(32).toString("hex");
  const commitment = await buildGameCommitment({ orbId: id, secretSeedHex, settingsHash, generatorVersion: GAME_GENERATOR_VERSION });
  const record: OrbRecord = {
    schemaVersion: 1,
    id,
    slug,
    createdAt: Date.now(),
    startsAt: Math.floor(input.startsAt),
    endsAt: Math.floor(input.startsAt) + ORB_COMPETITION_WINDOW_MS,
    status: "scheduled-test",
    hostWallet: input.hostWallet,
    hostX: input.hostX,
    difficulty: input.difficulty,
    style,
    token: {
      mint: input.token.mint,
      symbol: input.token.symbol,
      name: input.token.name,
      decimals: input.token.decimals,
      logoURI: input.token.logoURI,
      usdPrice: input.quotedUsdPrice,
    },
    prizeTokenAmount: input.prizeTokenAmount,
    prizeRawAmount: input.prizeRawAmount,
    prizeUsd,
    feeUsd: ORBS_FEE_USD,
    feeTokenAmount,
    feeRawAmount: input.feeRawAmount,
    priceQuotedAt: input.priceQuotedAt,
    generatorVersion: GAME_GENERATOR_VERSION,
    physicsVersion: GAME_PHYSICS_VERSION,
    rapierVersion: RAPIER_VERSION,
    settingsHash,
    commitment,
    encryptedSecretSeed: encryptSeed(secretSeedHex),
  };
  const ttl = Math.max(ORB_HISTORY_TTL_SECONDS, Math.ceil((orbEndsAt(record) - Date.now()) / 1000) + ORB_HISTORY_TTL_SECONDS);
  const enforceSingleActive = !isAdminWallet(record.hostWallet);
  if (enforceSingleActive) {
    const active = await getActiveHostedOrb(record.hostWallet);
    if (active) throw new Error(`This wallet already has an active Orb (${active.slug}). It can create another after that race closes.`);
  }
  const activeTtl = Math.max(60, Math.ceil((orbEndsAt(record) - Date.now()) / 1000));
  const storeScript = `
    if ARGV[5] == '1' then
      local locked = redis.call('SET', KEYS[3], ARGV[4], 'NX', 'EX', ARGV[6])
      if not locked then return 'ACTIVE_EXISTS' end
    end
    redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[3])
    redis.call('ZADD', KEYS[2], ARGV[2], ARGV[4])
    local count = redis.call('ZCARD', KEYS[2])
    if count > 100 then redis.call('ZREMRANGEBYRANK', KEYS[2], 0, count - 101) end
    local index_ttl = redis.call('TTL', KEYS[2])
    if index_ttl < tonumber(ARGV[3]) then redis.call('EXPIRE', KEYS[2], ARGV[3]) end
    return 'OK'
  `;
  const stored = await redisCommand<string>([
    "EVAL",
    storeScript,
    "3",
    orbKey(slug),
    hostedOrbsKey(record.hostWallet),
    activeHostedOrbKey(record.hostWallet),
    JSON.stringify(record),
    String(record.createdAt),
    String(ttl),
    slug,
    enforceSingleActive ? "1" : "0",
    String(activeTtl),
  ]);
  if (stored === "ACTIVE_EXISTS") throw new Error("This wallet already has an active Orb. It can create another after that race closes.");
  if (stored !== "OK") throw new Error("Could not persist the Orb");
  return publicRecord(record);
}

export async function getOrbRecord(slug: string) {
  if (!upstashConfigured()) return null;
  return redisGetJson<OrbRecord>(orbKey(slug));
}

export async function getPublicOrb(slug: string): Promise<PublicOrbRecord | null> {
  const record = await getOrbRecord(slug);
  return record ? publicRecord(record) : null;
}

export async function listHostedOrbs(wallet: string, limit = 50): Promise<PublicOrbRecord[]> {
  if (!upstashConfigured()) return [];
  const slugs = await redisCommand<string[]>([
    "ZREVRANGE",
    hostedOrbsKey(wallet),
    "0",
    String(Math.max(0, Math.min(100, limit) - 1)),
  ]);
  if (!slugs?.length) return [];
  const raw = await redisCommand<Array<string | null>>(["MGET", ...slugs.map(orbKey)]);
  return (raw || []).flatMap((value) => {
    if (!value) return [];
    try { return [publicRecord(JSON.parse(value) as OrbRecord)]; }
    catch { return []; }
  });
}

export async function listEnteredOrbs(wallet: string, limit = 50): Promise<PublicOrbRecord[]> {
  if (!upstashConfigured()) return [];
  const slugs = await redisCommand<string[]>([
    "ZREVRANGE",
    enteredOrbsKey(wallet),
    "0",
    String(Math.max(0, Math.min(100, limit) - 1)),
  ]);
  if (!slugs?.length) return [];
  const raw = await redisCommand<Array<string | null>>(["MGET", ...slugs.map(orbKey)]);
  return (raw || []).flatMap((value) => {
    if (!value) return [];
    try { return [publicRecord(JSON.parse(value) as OrbRecord)]; }
    catch { return []; }
  });
}

export async function getCanonicalOrbManifest(slug: string): Promise<{ record: OrbRecord; manifest: GameManifest; manifestHash: string }> {
  const record = await getOrbRecord(slug);
  if (!record) throw new Error("ORB_NOT_FOUND");
  if (Date.now() < record.startsAt) throw new Error("ORB_NOT_LIVE");
  if (record.generatorVersion !== GAME_GENERATOR_VERSION || record.physicsVersion !== GAME_PHYSICS_VERSION || record.rapierVersion !== RAPIER_VERSION) {
    throw new Error("ORB_VERSION_UNSUPPORTED");
  }
  const seed = decryptSeed(record.encryptedSecretSeed);
  const manifest = generateGameManifestFromSecret(record.slug, record.difficulty, record.style, seed);
  const manifestHash = await hashCanonicalManifest(manifest);
  return { record, manifest, manifestHash };
}
