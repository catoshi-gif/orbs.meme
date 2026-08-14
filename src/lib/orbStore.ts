import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { buildGameCommitment, hashCanonicalManifest, sha256Hex } from "@/game/canonical";
import { GAME_GENERATOR_VERSION, GAME_PHYSICS_VERSION, RAPIER_VERSION } from "@/game/constants";
import { generateGameManifestFromSecret } from "@/game/maze";
import type { DifficultyKey, GameManifest, GameStyle } from "@/game/types";
import type { WalletSplToken } from "@/lib/walletTokens";
import { MIN_PRIZE_USD, ORBS_FEE_USD, rawToTokenNumber } from "@/lib/prizeEconomics";
import { usdMicrosForRawAmount } from "@/lib/prizeQuote";
import type { XProfile } from "@/lib/xAuth";
import { redisCommand, redisGetJson, upstashConfigured } from "@/lib/upstash";
import { activeHostedOrbKey, enteredOrbsKey, isAdminWallet, ORB_COMPETITION_WINDOW_MS, ORB_CREATION_MIN_LEAD_MS, ORB_HISTORY_TTL_SECONDS, orbEndsAt } from "@/lib/orbLifecycle";

export type OrbTokenSnapshot = Pick<WalletSplToken, "mint" | "symbol" | "name" | "decimals" | "logoURI" | "usdPrice" | "isNativeSol">;

export type OrbRecord = {
  schemaVersion: 1;
  id: string;
  slug: string;
  createdAt: number;
  startsAt: number;
  endsAt?: number;
  status: "funding-pending" | "scheduled" | "scheduled-test" | "live-test" | "won-test";
  hostWallet: string;
  hostX: XProfile;
  difficulty: DifficultyKey;
  style: GameStyle;
  token: OrbTokenSnapshot;
  prizeTokenAmount: number;
  prizeRawAmount: string;
  prizeUsd: number;
  prizeUsdMicros: string;
  feeUsd: number;
  feeTokenAmount: number;
  feeRawAmount: string;
  priceQuotedAt: number;
  fundingQuoteExpiresAt: number;
  fundingTxSignature?: string;
  hostSharePostId?: string;
  hostSharePostCreatedAt?: number;
  orbPda?: string;
  prizeVault?: string;
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
const publicOrbsKey = "orbs:v1:public:funded";
const publicOrbsMigrationKey = "orbs:v1:public:funded:migrated-v2-onchain-only";

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

/**
 * Public discovery must contain only Orbs whose funding was actually verified
 * against the deployed Anchor program. Legacy test statuses from before mainnet
 * intentionally fail this predicate even if their timestamps are still current.
 */
function hasVerifiedOnChainFunding(record: OrbRecord) {
  return (
    record.status === "scheduled" &&
    typeof record.fundingTxSignature === "string" &&
    record.fundingTxSignature.trim().length > 0 &&
    typeof record.orbPda === "string" &&
    record.orbPda.trim().length > 0 &&
    typeof record.prizeVault === "string" &&
    record.prizeVault.trim().length > 0
  );
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

export async function getActiveHostedOrb(wallet: string): Promise<PublicOrbRecord | null> {
  if (!upstashConfigured() || isAdminWallet(wallet)) return null;
  const slug = await redisCommand<string>(["GET", activeHostedOrbKey(wallet)]);
  if (!slug) {
    // Backfill the lock for Orbs created before the one-active rule shipped.
    // This runs only on creator/dashboard policy checks and keeps deployment migration DB-light.
    const hosted = await listHostedOrbs(wallet, 100);
    const now = Date.now();
    const legacyActive = hosted.find((orb) =>
      now < orbEndsAt(orb) && (orb.status !== "funding-pending" || orb.fundingQuoteExpiresAt > now)
    );
    if (!legacyActive) return null;
    const lockUntil = legacyActive.status === "funding-pending" ? legacyActive.fundingQuoteExpiresAt + 60_000 : orbEndsAt(legacyActive);
    const ttl = Math.max(60, Math.ceil((lockUntil - Date.now()) / 1000));
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
  const now = Date.now();
  const pendingExpired = record.status === "funding-pending" && record.fundingQuoteExpiresAt <= now;
  if (pendingExpired || now >= orbEndsAt(record)) {
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
  fundingQuoteExpiresAt: number;
  startsAt: number;
}) {
  if (!orbStoreConfigured()) throw new Error("Orb storage is not configured");
  if (input.hostX.protected) throw new Error("Orb hosts must use a public X account so players can follow immediately");
  if (!input.token.eligible) throw new Error(input.token.ineligibleReason || "Selected token is not fundable");
  if (!Number.isFinite(input.prizeTokenAmount) || input.prizeTokenAmount <= 0 || !/^\d+$/.test(input.prizeRawAmount)) throw new Error("Invalid prize amount");
  if (!Number.isFinite(input.quotedUsdPrice) || input.quotedUsdPrice <= 0 || !/^\d+$/.test(input.feeRawAmount)) throw new Error("Invalid funding quote");
  if (!Number.isFinite(input.fundingQuoteExpiresAt) || input.fundingQuoteExpiresAt <= Date.now()) throw new Error("Funding quote expired");
  const prizeUsd = input.prizeTokenAmount * input.quotedUsdPrice;
  if (prizeUsd < MIN_PRIZE_USD) throw new Error(`Prize must be at least $${MIN_PRIZE_USD.toFixed(2)}`);
  const prizeUsdMicros = usdMicrosForRawAmount(BigInt(input.prizeRawAmount), input.token.decimals, input.quotedUsdPrice);
  if (prizeUsdMicros < BigInt(Math.round(MIN_PRIZE_USD * 1_000_000))) throw new Error(`Prize must be at least $${MIN_PRIZE_USD.toFixed(2)}`);
  const feeTokenAmount = rawToTokenNumber(input.feeRawAmount, input.token.decimals);
  const requiredRaw = BigInt(input.prizeRawAmount) + BigInt(input.feeRawAmount);
  if (requiredRaw > BigInt(input.token.rawAmount)) throw new Error(`Wallet balance does not cover the reviewed total commitment`);
  if (!Number.isFinite(input.startsAt) || input.startsAt < Date.now() + ORB_CREATION_MIN_LEAD_MS) throw new Error("Launch must be at least 60 seconds in the future");
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
    prizeUsdMicros: prizeUsdMicros.toString(),
    feeUsd: ORBS_FEE_USD,
    feeTokenAmount,
    feeRawAmount: input.feeRawAmount,
    tokenPriceUsd: input.quotedUsdPrice,
    priceQuotedAt: input.priceQuotedAt,
    fundingQuoteExpiresAt: input.fundingQuoteExpiresAt,
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
    status: "funding-pending",
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
      isNativeSol: input.token.isNativeSol === true,
    },
    prizeTokenAmount: input.prizeTokenAmount,
    prizeRawAmount: input.prizeRawAmount,
    prizeUsd,
    prizeUsdMicros: prizeUsdMicros.toString(),
    feeUsd: ORBS_FEE_USD,
    feeTokenAmount,
    feeRawAmount: input.feeRawAmount,
    priceQuotedAt: input.priceQuotedAt,
    fundingQuoteExpiresAt: input.fundingQuoteExpiresAt,
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
  const activeTtl = Math.max(60, Math.ceil((record.fundingQuoteExpiresAt - Date.now()) / 1000) + 60);
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

export async function finalizeFundedOrb(slug: string, fundingTxSignature: string, orbPda: string, prizeVault: string) {
  const record = await getOrbRecord(slug);
  if (!record) throw new Error("Orb funding record was not found");
  if (record.status !== "funding-pending") return publicRecord(record);
  const funded: OrbRecord = { ...record, status: "scheduled", fundingTxSignature, orbPda, prizeVault };
  const ttl = Math.max(ORB_HISTORY_TTL_SECONDS, Math.ceil((orbEndsAt(funded) - Date.now()) / 1000) + ORB_HISTORY_TTL_SECONDS);
  const activeTtl = Math.max(60, Math.ceil((orbEndsAt(funded) - Date.now()) / 1000));
  const script = `
    redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2])
    if ARGV[3] == '1' then redis.call('SET', KEYS[2], ARGV[4], 'EX', ARGV[5]) end
    redis.call('ZADD', KEYS[3], ARGV[6], ARGV[4])
    redis.call('ZREMRANGEBYSCORE', KEYS[3], '-inf', ARGV[7])
    return 'OK'
  `;
  const result = await redisCommand<string>([
    "EVAL", script, "3", orbKey(slug), activeHostedOrbKey(funded.hostWallet), publicOrbsKey,
    JSON.stringify(funded), String(ttl), isAdminWallet(funded.hostWallet) ? "0" : "1", slug, String(activeTtl),
    String(funded.startsAt), String(Date.now() - ORB_COMPETITION_WINDOW_MS - 60_000),
  ]);
  if (result !== "OK") throw new Error("Could not finalize funded Orb");
  return publicRecord(funded);
}

export async function getOrbRecord(slug: string) {
  if (!upstashConfigured()) return null;
  return redisGetJson<OrbRecord>(orbKey(slug));
}

export async function recordHostSharePost(slug: string, hostXId: string, postId: string, postCreatedAt: number) {
  const record = await getOrbRecord(slug);
  if (!record) throw new Error("Orb was not found");
  if (record.status === "funding-pending") throw new Error("Fund the Orb before verifying its host post");
  if (record.hostX.id !== hostXId) throw new Error("The connected X account is not this Orb's host");
  if (!/^\d{5,25}$/.test(postId)) throw new Error("Invalid X post ID");
  const updated: OrbRecord = { ...record, hostSharePostId: postId, hostSharePostCreatedAt: postCreatedAt };
  const currentTtl = Number(await redisCommand<number>(["TTL", orbKey(slug)]) || -1);
  const ttl = currentTtl > 0 ? currentTtl : ORB_HISTORY_TTL_SECONDS;
  const stored = await redisCommand<string>(["SET", orbKey(slug), JSON.stringify(updated), "EX", String(ttl)]);
  if (stored !== "OK") throw new Error("Could not save the host X post");
  return publicRecord(updated);
}

export async function getPublicOrb(slug: string): Promise<PublicOrbRecord | null> {
  const record = await getOrbRecord(slug);
  return record && hasVerifiedOnChainFunding(record) ? publicRecord(record) : null;
}


async function ensurePublicOrbIndex() {
  if (!upstashConfigured()) return;
  const migrated = await redisCommand<string>(["GET", publicOrbsMigrationKey]);
  if (migrated === "1") return;

  // V2 deliberately rebuilds the discoverable index. The previous migration
  // admitted legacy scheduled-test/live-test records from before Anchor mainnet.
  await redisCommand<number>(["DEL", publicOrbsKey]);

  let cursor = "0";
  let passes = 0;
  do {
    const scan = await redisCommand<[string, string[]]>(["SCAN", cursor, "MATCH", "orbs:v1:orb:*", "COUNT", "200"]);
    if (!scan) break;
    cursor = String(scan[0] || "0");
    const keys = scan[1] || [];
    if (keys.length) {
      const raw = await redisCommand<Array<string | null>>(["MGET", ...keys]);
      for (let i = 0; i < keys.length; i += 1) {
        const value = raw?.[i];
        if (!value) continue;
        try {
          const record = JSON.parse(value) as OrbRecord;
          if (hasVerifiedOnChainFunding(record) && Date.now() < orbEndsAt(record)) {
            await redisCommand<number>(["ZADD", publicOrbsKey, String(record.startsAt), record.slug]);
          }
        } catch {}
      }
    }
    passes += 1;
  } while (cursor !== "0" && passes < 20);
  if (cursor === "0") await redisCommand<string>(["SET", publicOrbsMigrationKey, "1"]);
}

export async function listDiscoverableOrbs(limit = 9): Promise<PublicOrbRecord[]> {
  if (!upstashConfigured()) return [];
  await ensurePublicOrbIndex();
  const now = Date.now();
  const max = Math.max(1, Math.min(30, Math.trunc(limit)));
  const slugs = await redisCommand<string[]>([
    "ZRANGEBYSCORE", publicOrbsKey, String(now - ORB_COMPETITION_WINDOW_MS), String(now + 1000 * 60 * 60 * 24 * 30),
    "LIMIT", "0", String(max * 3),
  ]);
  if (!slugs?.length) return [];
  const raw = await redisCommand<Array<string | null>>(["MGET", ...slugs.map(orbKey)]);
  const staleIndexMembers: string[] = [];
  const records = (raw || []).flatMap((value, index) => {
    const slug = slugs[index] || "";
    if (!value) {
      if (slug) staleIndexMembers.push(slug);
      return [];
    }
    try {
      const record = JSON.parse(value) as OrbRecord;
      if (!hasVerifiedOnChainFunding(record)) {
        if (slug) staleIndexMembers.push(slug);
        return [];
      }
      const publicOrb = publicRecord(record);
      if (now >= publicOrb.endsAt) {
        if (slug) staleIndexMembers.push(slug);
        return [];
      }
      return [publicOrb];
    } catch {
      if (slug) staleIndexMembers.push(slug);
      return [];
    }
  });
  if (staleIndexMembers.length) {
    await redisCommand<number>(["ZREM", publicOrbsKey, ...staleIndexMembers]);
  }
  return records.sort((a, b) => {
    const aLive = a.startsAt <= now ? 0 : 1;
    const bLive = b.startsAt <= now ? 0 : 1;
    return aLive - bLive || a.startsAt - b.startsAt;
  }).slice(0, max);
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
  if (!record || !hasVerifiedOnChainFunding(record)) throw new Error("ORB_NOT_FOUND");
  if (Date.now() < record.startsAt) throw new Error("ORB_NOT_LIVE");
  if (record.generatorVersion !== GAME_GENERATOR_VERSION || record.physicsVersion !== GAME_PHYSICS_VERSION || record.rapierVersion !== RAPIER_VERSION) {
    throw new Error("ORB_VERSION_UNSUPPORTED");
  }
  const seed = decryptSeed(record.encryptedSecretSeed);
  const manifest = generateGameManifestFromSecret(record.slug, record.difficulty, record.style, seed);
  const manifestHash = await hashCanonicalManifest(manifest);
  return { record, manifest, manifestHash };
}
