import "server-only";

import { createPublicKey, randomBytes, verify as verifySignature } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import { redisCommand, redisDelete, redisGetJson, redisSetJson } from "@/lib/upstash";

export const ELIGIBILITY_VERSION = "2026-08-14-v1";
export const TERMS_VERSION = "2026-08-14";
export const RULES_VERSION = "2026-08-14";
export const PRIVACY_VERSION = "2026-08-14";

const receiptKey = (wallet: string) => `orbs:v1:eligibility:${wallet}`;
const challengeKey = (wallet: string) => `orbs:v1:eligibility-challenge:${wallet}`;

export type EligibilityReceipt = {
  schemaVersion: 1;
  wallet: string;
  confirmedAt: string;
  eligibilityVersion: string;
  termsVersion: string;
  rulesVersion: string;
  privacyVersion: string;
};

function normalizeWallet(wallet: string) {
  return new PublicKey(wallet).toBase58();
}

function verifyWalletSignature(wallet: string, message: string, signatureBase64: string) {
  let signature: Buffer;
  try { signature = Buffer.from(signatureBase64, "base64"); } catch { return false; }
  if (signature.length !== 64) return false;
  const spkiPrefix = Buffer.from("302a300506032b6570032100", "hex");
  const key = createPublicKey({
    key: Buffer.concat([spkiPrefix, Buffer.from(new PublicKey(wallet).toBytes())]),
    format: "der",
    type: "spki",
  });
  return verifySignature(null, Buffer.from(message, "utf8"), key, signature);
}

export async function getEligibilityReceipt(wallet: string): Promise<EligibilityReceipt | null> {
  let normalized: string;
  try { normalized = normalizeWallet(wallet); } catch { return null; }
  const receipt = await redisGetJson<EligibilityReceipt>(receiptKey(normalized));
  if (
    !receipt ||
    receipt.schemaVersion !== 1 ||
    receipt.wallet !== normalized ||
    receipt.eligibilityVersion !== ELIGIBILITY_VERSION ||
    receipt.termsVersion !== TERMS_VERSION ||
    receipt.rulesVersion !== RULES_VERSION ||
    receipt.privacyVersion !== PRIVACY_VERSION
  ) return null;
  return receipt;
}

export async function hasEligibilityReceipt(wallet: string) {
  return Boolean(await getEligibilityReceipt(wallet));
}

export async function createEligibilityChallenge(wallet: string) {
  const normalized = normalizeWallet(wallet);
  const nonce = randomBytes(24).toString("base64url");
  const issuedAt = new Date().toISOString();
  const message = [
    "Orbs eligibility confirmation",
    `Wallet: ${normalized}`,
    `Eligibility version: ${ELIGIBILITY_VERSION}`,
    `Terms version: ${TERMS_VERSION}`,
    `Rules version: ${RULES_VERSION}`,
    `Privacy version: ${PRIVACY_VERSION}`,
    `Nonce: ${nonce}`,
    `Issued: ${issuedAt}`,
    "This signature confirms wallet ownership and your request to evaluate eligibility information you provide.",
    "This signature does not authorize a transaction or move funds.",
  ].join("\n");
  const stored = await redisSetJson(challengeKey(normalized), { message, issuedAt }, { exSeconds: 10 * 60 });
  if (!stored) throw new Error("Eligibility verification storage is temporarily unavailable");
  return { wallet: normalized, message };
}

function ageFromBirthDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) return null;
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (date > today || year < today.getUTCFullYear() - 120) return null;
  let age = today.getUTCFullYear() - year;
  if (
    today.getUTCMonth() < month - 1 ||
    (today.getUTCMonth() === month - 1 && today.getUTCDate() < day)
  ) age -= 1;
  return age;
}

export async function verifyEligibility(
  wallet: string,
  birthDate: string,
  signatureBase64: string,
) {
  const normalized = normalizeWallet(wallet);
  const pending = await redisGetJson<{ message: string }>(challengeKey(normalized));
  if (!pending?.message) throw new Error("Eligibility challenge expired. Please try again.");
  if (!verifyWalletSignature(normalized, pending.message, signatureBase64)) {
    throw new Error("Wallet eligibility signature could not be verified.");
  }

  const age = ageFromBirthDate(birthDate);
  if (age === null) throw new Error("Enter a valid date of birth.");
  if (age < 18) {
    await redisDelete(challengeKey(normalized));
    return { eligible: false as const };
  }

  const receipt: EligibilityReceipt = {
    schemaVersion: 1,
    wallet: normalized,
    confirmedAt: new Date().toISOString(),
    eligibilityVersion: ELIGIBILITY_VERSION,
    termsVersion: TERMS_VERSION,
    rulesVersion: RULES_VERSION,
    privacyVersion: PRIVACY_VERSION,
  };
  const stored = await redisSetJson(receiptKey(normalized), receipt);
  if (!stored) throw new Error("Eligibility receipt could not be saved.");
  await redisDelete(challengeKey(normalized));
  return { eligible: true as const, receipt };
}
