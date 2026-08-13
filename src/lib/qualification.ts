import { createPublicKey, randomBytes, verify as verifySignature } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import { redisCommand, redisDelete, redisGetJson, redisSetJson } from "@/lib/upstash";

export const followProofKey = (sourceXId: string, targetXId: string) => `orbs:v1:x:followproof:${sourceXId}:${targetXId}`;
export const walletProofKey = (slug: string, xUserId: string, wallet: string) => `orbs:v1:walletproof:${slug}:${xUserId}:${wallet}`;
export const shareProofKey = (slug: string, xUserId: string, wallet: string) => `orbs:v1:shareproof:${slug}:${xUserId}:${wallet}`;
const walletNonceKey = (slug: string, xUserId: string, wallet: string) => `orbs:v1:walletnonce:${slug}:${xUserId}:${wallet}`;
const entrantXKey = (slug: string, xUserId: string) => `orbs:v1:entrant:x:${slug}:${xUserId}`;
const entrantWalletKey = (slug: string, wallet: string) => `orbs:v1:entrant:wallet:${slug}:${wallet}`;

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
  await redisSetJson(walletNonceKey(slug, xUserId, normalized), { nonce, message, issuedAt }, { exSeconds: 10 * 60 });
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
  await redisDelete(walletNonceKey(slug, xUserId, normalized));
  await redisSetJson(walletProofKey(slug, xUserId, normalized), { verifiedAt: Date.now() }, { exSeconds: 60 * 60 * 24 * 35 });
  return true;
}

export type ShareProof = { postId: string; postCreatedAt: number; confirmedAt: number };

export async function storeShareProof(slug: string, xUserId: string, wallet: string, proof: ShareProof, ttlSeconds: number) {
  const normalized = new PublicKey(wallet).toBase58();
  await redisSetJson(shareProofKey(slug, xUserId, normalized), proof, { exSeconds: Math.max(60, ttlSeconds) });
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
