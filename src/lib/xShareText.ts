export function xCashtag(symbol: string | null | undefined) {
  const cleaned = String(symbol || "").trim().replace(/^\$+/, "");
  if (!cleaned || cleaned.toUpperCase() === "SPL") return cleaned || "SPL";
  // X cashtags are intended for compact asset/ticker symbols. Keep only the
  // characters that can safely appear in a cashtag and cap pathological metadata.
  const ticker = cleaned.replace(/[^A-Za-z0-9_]/g, "").slice(0, 16);
  return ticker ? `$${ticker}` : cleaned;
}

export function xCashtagPrize(prize: string) {
  const value = prize.trim();
  const match = value.match(/^(.*?)(?:\s+)(\$?[A-Za-z0-9_]{1,16})$/);
  if (!match) return value;
  return `${match[1]} ${xCashtag(match[2])}`;
}
