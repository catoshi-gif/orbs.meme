export const MIN_PRIZE_USD = 5.00;
export const ORBS_FEE_USD = 1.15;
export const MIN_WALLET_REQUIREMENT_USD = MIN_PRIZE_USD + ORBS_FEE_USD;

export type PrizeQuoteSnapshot = {
  token: string;
  usdPrice: number;
  feeUsd: number;
  feeRawAmount: string;
  feeTokenAmount: number;
  issuedAt: number;
  expiresAt: number;
};

export function feeTokenAmountForPrice(usdPrice: number | null | undefined) {
  return usdPrice && Number.isFinite(usdPrice) && usdPrice > 0 ? ORBS_FEE_USD / usdPrice : 0;
}

export function floorTokenAmount(value: number, decimals: number) {
  if (!Number.isFinite(value) || value <= 0) return 0;
  const places = Math.max(0, Math.min(9, Math.trunc(decimals || 0)));
  const factor = 10 ** places;
  return Math.floor((value + Number.EPSILON) * factor) / factor;
}

export function maxPrizeTokenAmount(balance: number, usdPrice: number | null | undefined, decimals: number) {
  const fee = feeTokenAmountForPrice(usdPrice);
  if (!Number.isFinite(balance) || balance <= fee) return 0;
  return floorTokenAmount(balance - fee, decimals);
}

export function tokenInputValue(value: number, decimals: number) {
  if (!Number.isFinite(value) || value <= 0) return "";
  const places = Math.max(0, Math.min(9, Math.trunc(decimals || 0)));
  return value.toFixed(places).replace(/\.?0+$/, "");
}

export function rawToTokenInput(rawAmount: string | bigint, decimals: number) {
  const raw = typeof rawAmount === "bigint" ? rawAmount : /^\d+$/.test(rawAmount) ? BigInt(rawAmount) : BigInt(0);
  const places = Math.max(0, Math.trunc(decimals || 0));
  if (places === 0) return raw.toString();
  const scale = BigInt(10) ** BigInt(places);
  const whole = raw / scale;
  const fraction = (raw % scale).toString().padStart(places, "0").replace(/0+$/, "");
  return fraction ? `${whole.toString()}.${fraction}` : whole.toString();
}

export function tokenInputToRaw(value: string, decimals: number): bigint | null {
  const text = value.trim();
  // HTML number inputs commonly produce leading-decimal values such as `.12`.
  // Treat `.12` and `0.12` identically while still rejecting bare `.` and
  // non-decimal/scientific notation so the reviewed atomic amount is unambiguous.
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)) return null;
  const places = Math.max(0, Math.trunc(decimals || 0));
  const [wholeText, fractionText = ""] = text.split(".");
  if (fractionText.length > places && /[1-9]/.test(fractionText.slice(places))) return null;
  const normalizedFraction = fractionText.slice(0, places).padEnd(places, "0");
  const scale = BigInt(10) ** BigInt(places);
  return BigInt(wholeText || "0") * scale + BigInt(normalizedFraction || "0");
}

export function rawToTokenNumber(rawAmount: string | bigint, decimals: number) {
  const value = Number(rawToTokenInput(rawAmount, decimals));
  return Number.isFinite(value) ? value : 0;
}

export function maxPrizeInputFromQuote(balanceRaw: string, feeRawAmount: string, decimals: number) {
  if (!/^\d+$/.test(balanceRaw) || !/^\d+$/.test(feeRawAmount)) return "";
  const balance = BigInt(balanceRaw);
  const fee = BigInt(feeRawAmount);
  if (balance <= fee) return "";
  return rawToTokenInput(balance - fee, decimals);
}
