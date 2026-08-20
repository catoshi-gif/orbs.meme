import "server-only";

import { PublicKey } from "@solana/web3.js";
import { redisGetJson, redisSetJson } from "@/lib/upstash";

export const FAIR_PLAY_VERSION = "2026-08-20-v1";
export const FAIR_PLAY_TERMS_VERSION = "2026-08-20";

export type FairPlayReceipt = {
  schemaVersion: 1;
  wallet: string;
  xUserId: string;
  acceptedAt: string;
  fairPlayVersion: string;
  termsVersion: string;
};

function normalizeWallet(wallet: string) {
  return new PublicKey(wallet).toBase58();
}

function receiptKey(wallet: string, xUserId: string) {
  return `orbs:v1:fair-play:${xUserId}:${wallet}`;
}

export async function getFairPlayReceipt(wallet: string, xUserId: string): Promise<FairPlayReceipt | null> {
  let normalized: string;
  try { normalized = normalizeWallet(wallet); } catch { return null; }
  if (!xUserId) return null;
  const receipt = await redisGetJson<FairPlayReceipt>(receiptKey(normalized, xUserId));
  if (
    !receipt ||
    receipt.schemaVersion !== 1 ||
    receipt.wallet !== normalized ||
    receipt.xUserId !== xUserId ||
    receipt.fairPlayVersion !== FAIR_PLAY_VERSION ||
    receipt.termsVersion !== FAIR_PLAY_TERMS_VERSION
  ) return null;
  return receipt;
}

export async function hasFairPlayReceipt(wallet: string, xUserId: string) {
  return Boolean(await getFairPlayReceipt(wallet, xUserId));
}

export async function saveFairPlayReceipt(wallet: string, xUserId: string) {
  const normalized = normalizeWallet(wallet);
  if (!xUserId) throw new Error("Connect X before accepting the Fair Play Policy.");
  const receipt: FairPlayReceipt = {
    schemaVersion: 1,
    wallet: normalized,
    xUserId,
    acceptedAt: new Date().toISOString(),
    fairPlayVersion: FAIR_PLAY_VERSION,
    termsVersion: FAIR_PLAY_TERMS_VERSION,
  };
  const stored = await redisSetJson(receiptKey(normalized, xUserId), receipt);
  if (!stored) throw new Error("Fair Play acceptance could not be saved.");
  return receipt;
}
