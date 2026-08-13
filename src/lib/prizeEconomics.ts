export const MIN_PRIZE_USD = 5.00;
export const ORBS_FEE_USD = 1.15;
export const MIN_WALLET_REQUIREMENT_USD = MIN_PRIZE_USD + ORBS_FEE_USD;

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
