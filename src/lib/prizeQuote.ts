import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { ORBS_FEE_USD, rawToTokenNumber, type PrizeQuoteSnapshot } from "@/lib/prizeEconomics";

const QUOTE_SCHEMA_VERSION = 1 as const;
// Keep UI/server quotes comfortably inside the program's absolute 10-minute cap.
const QUOTE_TTL_MS = 8 * 60 * 1000;

type PrizeQuotePayload = {
  schemaVersion: typeof QUOTE_SCHEMA_VERSION;
  wallet: string;
  mint: string;
  decimals: number;
  usdPrice: number;
  feeUsd: number;
  feeRawAmount: string;
  issuedAt: number;
  expiresAt: number;
};

function signingSecret() {
  const value = (process.env.ORBS_FUNDING_QUOTE_SIGNING_KEY || "").trim();
  if (value.length < 32) throw new Error("ORBS_FUNDING_QUOTE_SIGNING_KEY must be a long random secret");
  return value;
}

function signatureFor(encodedPayload: string) {
  return createHmac("sha256", signingSecret())
    .update(`orbs:prize-quote:v1:${encodedPayload}`, "utf8")
    .digest("base64url");
}

function decimalRational(value: number): { numerator: bigint; denominator: bigint } {
  if (!Number.isFinite(value) || value <= 0) throw new Error("Invalid token price");
  const text = value.toString().toLowerCase();
  const [coefficient, exponentText = "0"] = text.split("e");
  const exponent = Number(exponentText);
  const [whole = "0", fraction = ""] = coefficient.split(".");
  const digits = `${whole}${fraction}`.replace(/^0+(?=\d)/, "") || "0";
  let numerator = BigInt(digits);
  let scale = fraction.length - exponent;
  if (scale < 0) {
    numerator *= BigInt(10) ** BigInt(-scale);
    scale = 0;
  }
  return { numerator, denominator: BigInt(10) ** BigInt(scale) };
}

function ceilDiv(numerator: bigint, denominator: bigint) {
  return (numerator + denominator - BigInt(1)) / denominator;
}

export function usdMicrosForRawAmount(rawAmount: bigint, decimals: number, usdPrice: number) {
  if (rawAmount <= BigInt(0)) return BigInt(0);
  const places = Math.max(0, Math.trunc(decimals || 0));
  const price = decimalRational(usdPrice);
  const tokenScale = BigInt(10) ** BigInt(places);
  // Conservative floor: never let display floating point round a sub-$5 prize
  // upward across the protocol minimum enforced by the on-chain quote signer.
  return (rawAmount * price.numerator * BigInt(1_000_000)) / (tokenScale * price.denominator);
}

function feeRawForPrice(usdPrice: number, decimals: number) {
  const places = Math.max(0, Math.trunc(decimals || 0));
  const price = decimalRational(usdPrice);
  // ORBS_FEE_USD is intentionally $1.15 today. Express the USD fee as integer
  // cents so the atomic token amount is rounded UP exactly, never down because
  // of floating point display math.
  const feeCents = BigInt(Math.round(ORBS_FEE_USD * 100));
  const tokenScale = BigInt(10) ** BigInt(places);
  return ceilDiv(feeCents * tokenScale * price.denominator, BigInt(100) * price.numerator);
}

function encodePayload(payload: PrizeQuotePayload) {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

export function issuePrizeQuote(input: { wallet: string; mint: string; decimals: number; usdPrice: number }): PrizeQuoteSnapshot {
  const now = Date.now();
  const feeRawAmount = feeRawForPrice(input.usdPrice, input.decimals).toString();
  const payload: PrizeQuotePayload = {
    schemaVersion: QUOTE_SCHEMA_VERSION,
    wallet: input.wallet,
    mint: input.mint,
    decimals: input.decimals,
    usdPrice: input.usdPrice,
    feeUsd: ORBS_FEE_USD,
    feeRawAmount,
    issuedAt: now,
    expiresAt: now + QUOTE_TTL_MS,
  };
  const encoded = encodePayload(payload);
  return {
    token: `${encoded}.${signatureFor(encoded)}`,
    usdPrice: payload.usdPrice,
    feeUsd: payload.feeUsd,
    feeRawAmount,
    feeTokenAmount: rawToTokenNumber(feeRawAmount, input.decimals),
    issuedAt: payload.issuedAt,
    expiresAt: payload.expiresAt,
  };
}

export function verifyPrizeQuote(token: string): PrizeQuotePayload | null {
  const [encoded, supplied, ...extra] = token.split(".");
  if (!encoded || !supplied || extra.length) return null;
  const expected = signatureFor(encoded);
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(supplied, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  let payload: PrizeQuotePayload;
  try { payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as PrizeQuotePayload; } catch { return null; }
  if (payload.schemaVersion !== QUOTE_SCHEMA_VERSION) return null;
  if (!payload.wallet || !payload.mint || !Number.isInteger(payload.decimals) || payload.decimals < 0) return null;
  if (!Number.isFinite(payload.usdPrice) || payload.usdPrice <= 0 || payload.feeUsd !== ORBS_FEE_USD) return null;
  if (!/^\d+$/.test(payload.feeRawAmount) || BigInt(payload.feeRawAmount) <= BigInt(0)) return null;
  const now = Date.now();
  if (!Number.isFinite(payload.issuedAt) || !Number.isFinite(payload.expiresAt)) return null;
  if (payload.issuedAt > now + 30_000 || payload.expiresAt <= now) return null;
  if (payload.expiresAt - payload.issuedAt !== QUOTE_TTL_MS) return null;
  return payload;
}
