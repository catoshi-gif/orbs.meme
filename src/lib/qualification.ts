import { createPublicKey, randomBytes, verify as verifySignature } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import { redisCommand, redisDelete, redisGetJson, redisSetJson } from "@/lib/upstash";
import { enteredOrbsKey, ORB_HISTORY_TTL_SECONDS } from "@/lib/orbLifecycle";

export const followProofKey = (sourceXId: string, targetXId: string) => `orbs:v1:x:followproof:${sourceXId}:${targetXId}`;
export const walletProofKey = (slug: string, xUserId: string, wallet: string) => `orbs:v1:walletproof:${slug}:${xUserId}:${wallet}`;
export const shareProofKey = (slug: string, xUserId: string, wallet: string) => `orbs:v1:shareproof:${slug}:${xUserId}:${wallet}`;
export const shareIntentKey = (slug: string, xUserId: string, wallet: string) => `orbs:v1:shareintent:${slug}:${xUserId}:${wallet}`;
const walletNonceKey = (slug: string, xUserId: string, wallet: string) => `orbs:v1:walletnonce:${slug}:${xUserId}:${wallet}`;
const entrantXKey = (slug: string, xUserId: string) => `orbs:v1:entrant:x:${slug}:${xUserId}`;
const entrantWalletKey = (slug: string, wallet: string) => `orbs:v1:entrant:wallet:${slug}:${wallet}`;

function normalizeWallet(value: unknown) {
  if (typeof value !== "string") return null;
  try { return new PublicKey(value).toBase58(); } catch { return null; }
}

async function bindEntrantIdentity(slug: string, xUserId: string, wallet: string) {
  const script = `
    local by_x = redis.call('GET', KEYS[1])
    if by_x and by_x ~= ARGV[1] then return 'X_BOUND' end
    local by_wallet = redis.call('GET', KEYS[2])
    if by_wallet and by_wallet ~= ARGV[2] then return 'WALLET_BOUND' end
    redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[3])
    redis.call('SET', KEYS[2], ARGV[2], 'EX', ARGV[3])
    return 'OK'
  `;
  const result = await redisCommand<string>(['EVAL', script, '2', entrantXKey(slug, xUserId), entrantWalletKey(slug, wallet), wallet, xUserId, String(60 * 60 * 24 * 35)]);
  if (result === 'X_BOUND') throw new Error('This X account is already qualified with a different wallet for this Orb.');
  if (result === 'WALLET_BOUND') throw new Error('This wallet is already qualified with a different X account for this Orb.');
  if (result !== 'OK') throw new Error('Could not reserve this Orb identity.');
}


export async function hasFollowProof(sourceXId: string, targetXId: string) {
  if (sourceXId === targetXId) return true;
  return Boolean(await redisGetJson<{ confirmedAt: number }>(followProofKey(sourceXId, targetXId)));
}

export async function createWalletChallenge(slug: string, xUserId: string, wallet: string) {
  const normalized = new PublicKey(wallet).toBase58();
  const nonce = randomBytes(24).toString("base64url");
  const issuedAt = new Date().toISOString();
  const message = ["Orbs wallet verification", `Orb: ${slug}`, `Wallet: ${normalized}`, `X user: ${xUserId}`, `Nonce: ${nonce}`, `Issued: ${issuedAt}`, "This signature does not authorize a transaction or move funds."].join("\n");
  const stored = await redisSetJson(walletNonceKey(slug, xUserId, normalized), { nonce, message, issuedAt }, { exSeconds: 10 * 60 });
  if (!stored) throw new Error("Wallet verification storage is temporarily unavailable");
  return { wallet: normalized, message };
}

export async function verifyWalletChallenge(slug: string, xUserId: string, wallet: string, signatureBase64: string) {
  const normalized = new PublicKey(wallet).toBase58();
  const pending = await redisGetJson<{ message: string }>(walletNonceKey(slug, xUserId, normalized));
  if (!pending) return false;
  let signature: Buffer;
  try { signature = Buffer.from(signatureBase64, "base64"); } catch { return false; }
  if (signature.length !== 64) return false;
  const publicBytes = new PublicKey(normalized).toBytes();
  const spkiPrefix = Buffer.from("302a300506032b6570032100", "hex");
  const key = createPublicKey({ key: Buffer.concat([spkiPrefix, Buffer.from(publicBytes)]), format: "der", type: "spki" });
  const ok = verifySignature(null, Buffer.from(pending.message, "utf8"), key, signature);
  if (!ok) return false;
  await bindEntrantIdentity(slug, xUserId, normalized);
  const stored = await redisSetJson(walletProofKey(slug, xUserId, normalized), { verifiedAt: Date.now() }, { exSeconds: 60 * 60 * 24 * 35 });
  if (!stored) throw new Error("Wallet proof storage is temporarily unavailable");
  await redisDelete(walletNonceKey(slug, xUserId, normalized));
  return true;
}

export type ShareProof = { postId: string; postCreatedAt: number; confirmedAt: number };

export type ShareIntent = {
  originalLine: string;
  startedAt: number;
};

export async function storeShareIntent(
  slug: string,
  xUserId: string,
  wallet: string,
  intent: ShareIntent,
  ttlSeconds = 30 * 60,
) {
  const normalized = normalizeWallet(wallet);
  if (!normalized) throw new Error("INVALID_WALLET");
  await redisCommand(["SET", shareIntentKey(slug, xUserId, normalized), JSON.stringify(intent), "EX", ttlSeconds]);
}

export async function getShareIntent(slug: string, xUserId: string, wallet: string) {
  const normalized = normalizeWallet(wallet);
  if (!normalized) return null;
  return redisGetJson<ShareIntent>(shareIntentKey(slug, xUserId, normalized));
}

export async function clearShareIntent(slug: string, xUserId: string, wallet: string) {
  const normalized = normalizeWallet(wallet);
  if (!normalized) return;
  await redisCommand(["DEL", shareIntentKey(slug, xUserId, normalized)]);
}


const orbEntrantsKey = (slug: string) => `orbs:v1:entrants:${slug}`;

export async function indexEnteredOrb(slug: string, wallet: string, enteredAt = Date.now(), ttlSeconds = ORB_HISTORY_TTL_SECONDS) {
  const normalized = new PublicKey(wallet).toBase58();
  const key = enteredOrbsKey(normalized);
  const stored = await redisCommand<number>([
    "EVAL",
    `
      redis.call('ZADD', KEYS[1], ARGV[1], ARGV[2])
      local count = redis.call('ZCARD', KEYS[1])
      if count > 100 then redis.call('ZREMRANGEBYRANK', KEYS[1], 0, count - 101) end
      local ttl = redis.call('TTL', KEYS[1])
      if ttl < tonumber(ARGV[3]) then redis.call('EXPIRE', KEYS[1], ARGV[3]) end
      return 1
    `,
    "1",
    key,
    String(enteredAt),
    slug,
    String(Math.max(ORB_HISTORY_TTL_SECONDS, ttlSeconds)),
  ]);
  if (stored !== 1) throw new Error("Could not index this Orb entry");
}

export async function storeShareProof(slug: string, xUserId: string, wallet: string, proof: ShareProof, ttlSeconds: number, activityTtlSeconds = ORB_HISTORY_TTL_SECONDS) {
  const normalized = new PublicKey(wallet).toBase58();
  const proofTtl = Math.max(60, ttlSeconds);
  const stored = await redisCommand<number>([
    "EVAL",
    `
      redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2])
      redis.call('ZADD', KEYS[2], ARGV[3], ARGV[4])
      redis.call('SADD', KEYS[3], ARGV[6])
      local count = redis.call('ZCARD', KEYS[2])
      if count > 100 then redis.call('ZREMRANGEBYRANK', KEYS[2], 0, count - 101) end
      local ttl = redis.call('TTL', KEYS[2])
      if ttl < tonumber(ARGV[5]) then redis.call('EXPIRE', KEYS[2], ARGV[5]) end
      local entrant_ttl = redis.call('TTL', KEYS[3])
      if entrant_ttl < tonumber(ARGV[5]) then redis.call('EXPIRE', KEYS[3], ARGV[5]) end
      return 1
    `,
    "3",
    shareProofKey(slug, xUserId, normalized),
    enteredOrbsKey(normalized),
    orbEntrantsKey(slug),
    JSON.stringify(proof),
    String(proofTtl),
    String(proof.confirmedAt),
    slug,
    String(Math.max(ORB_HISTORY_TTL_SECONDS, activityTtlSeconds)),
    `${xUserId}:${normalized}`,
  ]);
  if (stored !== 1) throw new Error("Could not persist this verified Orb entry");
}

export async function getShareProof(slug: string, xUserId: string, wallet: string) {
  let normalized: string;
  try { normalized = new PublicKey(wallet).toBase58(); } catch { return null; }
  return redisGetJson<ShareProof>(shareProofKey(slug, xUserId, normalized));
}

export async function hasShareProof(slug: string, xUserId: string, wallet: string) {
  return Boolean(await getShareProof(slug, xUserId, wallet));
}

export async function hasWalletProof(slug: string, xUserId: string, wallet: string) {
  let normalized: string;
  try { normalized = new PublicKey(wallet).toBase58(); } catch { return false; }
  return Boolean(await redisGetJson<{ verifiedAt: number }>(walletProofKey(slug, xUserId, normalized)));
}

export async function getOrbEntrantCounts(slugs: string[]): Promise<Map<string, number>> {
  const unique = [...new Set(slugs.filter(Boolean))];
  const result = new Map<string, number>();
  if (!unique.length) return result;
  const counts = await Promise.all(unique.map(async (slug) => Number(await redisCommand<number>(["SCARD", orbEntrantsKey(slug)]) || 0)));
  unique.forEach((slug, index) => result.set(slug, counts[index] || 0));
  return result;
}
