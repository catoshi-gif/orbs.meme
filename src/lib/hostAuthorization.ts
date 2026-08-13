import { createPublicKey, randomBytes, verify as verifySignature } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import { redisCommand, redisSetJson } from "@/lib/upstash";

const hostCreateNonceKey = (wallet: string) => `orbs:v1:host-create-nonce:${wallet}`;

type HostCreateChallenge = {
  message: string;
  xUserId: string;
  issuedAt: string;
};

function normalizedWallet(wallet: string) {
  return new PublicKey(wallet).toBase58();
}

export async function createHostAuthorizationChallenge(wallet: string, xUserId: string) {
  const normalized = normalizedWallet(wallet);
  const issuedAt = new Date().toISOString();
  const nonce = randomBytes(24).toString("base64url");
  const message = [
    "Orbs host authorization",
    `Wallet: ${normalized}`,
    `X user: ${xUserId}`,
    `Nonce: ${nonce}`,
    `Issued: ${issuedAt}`,
    "Authorize creation of one Orb with this wallet. This signature does not move funds.",
  ].join("\n");
  const stored = await redisSetJson(hostCreateNonceKey(normalized), { message, xUserId, issuedAt } satisfies HostCreateChallenge, { exSeconds: 10 * 60 });
  if (!stored) throw new Error("HOST_AUTHORIZATION_STORAGE_UNAVAILABLE");
  return { wallet: normalized, message };
}

export async function consumeHostAuthorization(wallet: string, xUserId: string, signatureBase64: string) {
  const normalized = normalizedWallet(wallet);
  const key = hostCreateNonceKey(normalized);
  const raw = await redisCommand<string>(["GET", key]);
  if (!raw) return false;

  let pending: HostCreateChallenge;
  try { pending = JSON.parse(raw) as HostCreateChallenge; } catch { return false; }
  if (!pending.message || pending.xUserId !== xUserId) return false;

  let signature: Buffer;
  try { signature = Buffer.from(signatureBase64, "base64"); } catch { return false; }
  if (signature.length !== 64) return false;
  const spkiPrefix = Buffer.from("302a300506032b6570032100", "hex");
  const keyObject = createPublicKey({
    key: Buffer.concat([spkiPrefix, Buffer.from(new PublicKey(normalized).toBytes())]),
    format: "der",
    type: "spki",
  });
  if (!verifySignature(null, Buffer.from(pending.message, "utf8"), keyObject, signature)) return false;

  const consumed = await redisCommand<number>([
    "EVAL",
    "if redis.call('GET', KEYS[1]) == ARGV[1] then redis.call('DEL', KEYS[1]); return 1 end; return 0",
    "1",
    key,
    raw,
  ]);
  return consumed === 1;
}
