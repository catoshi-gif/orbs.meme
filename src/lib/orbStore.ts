import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { buildGameCommitment, hashCanonicalManifest, sha256Hex } from "@/game/canonical";
import { GAME_GENERATOR_VERSION, GAME_PHYSICS_VERSION, RAPIER_VERSION } from "@/game/constants";
import { generateGameManifestFromSecret } from "@/game/maze";
import type { DifficultyKey, GameManifest, GameStyle } from "@/game/types";
import type { WalletSplToken } from "@/lib/walletTokens";
import type { XProfile } from "@/lib/xAuth";
import { redisGetJson, redisSetJson, upstashConfigured } from "@/lib/upstash";

export const ORBS_FEE_USD = 1.10;
export const MIN_PRIZE_USD = 6.00;

export type OrbTokenSnapshot = Pick<WalletSplToken, "mint" | "symbol" | "name" | "decimals" | "logoURI" | "usdPrice">;

export type OrbRecord = {
  schemaVersion: 1;
  id: string;
  slug: string;
  createdAt: number;
  startsAt: number;
  status: "scheduled-test" | "live-test" | "won-test";
  hostWallet: string;
  hostX: XProfile;
  difficulty: DifficultyKey;
  style: GameStyle;
  token: OrbTokenSnapshot;
  prizeTokenAmount: number;
  prizeUsd: number;
  feeUsd: 1.10;
  feeTokenAmount: number;
  generatorVersion: string;
  physicsVersion: string;
  rapierVersion: string;
  settingsHash: string;
  commitment: string;
  encryptedSecretSeed: string;
};

export type PublicOrbRecord = Omit<OrbRecord, "encryptedSecretSeed">;

const orbKey = (slug: string) => `orbs:v1:orb:${slug}`;

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
  const { encryptedSecretSeed: _secret, ...safe } = record;
  return safe;
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
  startsAt: number;
}) {
  if (!orbStoreConfigured()) throw new Error("Orb storage is not configured");
  if (input.hostX.protected) throw new Error("Orb hosts must use a public X account so players can follow immediately");
  if (!input.token.eligible || !input.token.usdPrice) throw new Error(input.token.ineligibleReason || "Selected token is not fundable");
  if (!Number.isFinite(input.prizeTokenAmount) || input.prizeTokenAmount <= 0) throw new Error("Invalid prize amount");
  const prizeUsd = input.prizeTokenAmount * input.token.usdPrice;
  if (prizeUsd < MIN_PRIZE_USD) throw new Error(`Prize must be at least $${MIN_PRIZE_USD.toFixed(2)}`);
  const feeTokenAmount = ORBS_FEE_USD / input.token.usdPrice;
  if (input.prizeTokenAmount + feeTokenAmount > input.token.balance * 1.000000001) throw new Error("Wallet balance does not cover the prize plus the $1.10 Orbs fee");
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
      usdPrice: input.token.usdPrice,
    },
    prizeTokenAmount: input.prizeTokenAmount,
    prizeUsd,
    feeUsd: ORBS_FEE_USD,
    feeTokenAmount,
    generatorVersion: GAME_GENERATOR_VERSION,
    physicsVersion: GAME_PHYSICS_VERSION,
    rapierVersion: RAPIER_VERSION,
    settingsHash,
    commitment,
    encryptedSecretSeed: encryptSeed(secretSeedHex),
  };
  const ttl = Math.max(60 * 60 * 24 * 7, Math.ceil((input.startsAt - Date.now()) / 1000) + 60 * 60 * 24 * 14);
  await redisSetJson(orbKey(slug), record, { exSeconds: ttl });
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
