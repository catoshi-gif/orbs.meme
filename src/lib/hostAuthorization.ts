import "server-only";

import { createPublicKey, randomBytes, verify as verifySignature } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import { redisCommand, redisSetJson } from "@/lib/upstash";

const hostCreateNonceKey = (wallet: string) => `orbs:v1:host-create-nonce:${wallet}`;

type HostFundingIntent = {
  mint: string;
  prizeRawAmount: string;
  feeRawAmount: string;
  decimals: number;
  startsAtUnixSeconds: number;
};

type HostCreateChallenge = HostFundingIntent & {
  message: string;
  xUserId: string;
  issuedAt: string;
};

function normalizedWallet(wallet: string) {
  return new PublicKey(wallet).toBase58();
}

function displayRaw(rawText: string, decimals: number) {
  if (!/^\d+$/.test(rawText) || !Number.isInteger(decimals) || decimals < 0) throw new Error("Invalid funding amount");
  const raw = BigInt(rawText);
  if (decimals === 0) return raw.toString();
  const padded = raw.toString().padStart(decimals + 1, "0");
  const whole = padded.slice(0, -decimals);
  const fraction = padded.slice(-decimals).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

export async function createHostAuthorizationChallenge(
  wallet: string,
  xUserId: string,
  intent: HostFundingIntent,
) {
  const normalized = normalizedWallet(wallet);
  const mint = new PublicKey(intent.mint).toBase58();
  if (!/^\d+$/.test(intent.prizeRawAmount) || BigInt(intent.prizeRawAmount) <= BigInt(0)) throw new Error("Invalid prize amount");
  if (!/^\d+$/.test(intent.feeRawAmount) || BigInt(intent.feeRawAmount) <= BigInt(0)) throw new Error("Invalid fee amount");
  if (!Number.isInteger(intent.decimals) || intent.decimals < 0 || intent.decimals > 255) throw new Error("Invalid token decimals");
  if (!Number.isInteger(intent.startsAtUnixSeconds) || intent.startsAtUnixSeconds <= 0) throw new Error("Invalid launch time");

  const issuedAt = new Date().toISOString();
  const nonce = randomBytes(24).toString("base64url");
  const normalizedIntent: HostFundingIntent = { ...intent, mint };
  const message = [
    "Orbs host funding authorization",
    `Wallet: ${normalized}`,
    `X user: ${xUserId}`,
    `Token mint: ${mint}`,
    `Winner prize: ${displayRaw(intent.prizeRawAmount, intent.decimals)} tokens`,
    `Prize atomic units: ${intent.prizeRawAmount}`,
    `Orbs fee: ${displayRaw(intent.feeRawAmount, intent.decimals)} tokens`,
    `Fee atomic units: ${intent.feeRawAmount}`,
    `Launch unix time: ${intent.startsAtUnixSeconds}`,
    `Nonce: ${nonce}`,
    `Issued: ${issuedAt}`,
    "Authorize one Orbs Anchor escrow funding transaction with exactly these token amounts and launch time.",
    "The prize may only enter the Orb's isolated vault and the fee may only enter the fixed Orbs treasury ATA.",
  ].join("\n");
  const stored = await redisSetJson(
    hostCreateNonceKey(normalized),
    { message, xUserId, issuedAt, ...normalizedIntent } satisfies HostCreateChallenge,
    { exSeconds: 10 * 60 },
  );
  if (!stored) throw new Error("HOST_AUTHORIZATION_STORAGE_UNAVAILABLE");
  return { wallet: normalized, message };
}

export async function consumeHostAuthorization(
  wallet: string,
  xUserId: string,
  signatureBase64: string,
  expected: HostFundingIntent,
) {
  const normalized = normalizedWallet(wallet);
  const key = hostCreateNonceKey(normalized);
  const raw = await redisCommand<string>(["GET", key]);
  if (!raw) return false;

  let pending: HostCreateChallenge;
  try { pending = JSON.parse(raw) as HostCreateChallenge; } catch { return false; }
  let expectedMint: string;
  try { expectedMint = new PublicKey(expected.mint).toBase58(); } catch { return false; }
  if (
    !pending.message ||
    pending.xUserId !== xUserId ||
    pending.mint !== expectedMint ||
    pending.prizeRawAmount !== expected.prizeRawAmount ||
    pending.feeRawAmount !== expected.feeRawAmount ||
    pending.decimals !== expected.decimals ||
    pending.startsAtUnixSeconds !== expected.startsAtUnixSeconds
  ) return false;

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
