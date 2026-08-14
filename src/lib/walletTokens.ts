import { PublicKey } from "@solana/web3.js";
import type { PrizeQuoteSnapshot } from "@/lib/prizeEconomics";
import { CLASSIC_SPL_TOKEN_PROGRAM_ID, deriveClassicAta } from "@/lib/solanaAddresses";

const CLASSIC_SPL_TOKEN_PROGRAM = CLASSIC_SPL_TOKEN_PROGRAM_ID.toBase58();

export type WalletSplToken = {
  mint: string;
  symbol: string;
  name: string;
  decimals: number;
  balance: number;
  rawAmount: string;
  usdPrice: number | null;
  usdValue: number | null;
  logoURI: string | null;
  verified: boolean;
  suspicious: boolean;
  eligible: boolean;
  ineligibleReason?: string;
  prizeQuote?: PrizeQuoteSnapshot | null;
};

function rpcUrl() {
  return (
    process.env.HELIUS_RPC_URL ||
    process.env.SOLANA_MAINNET_RPC ||
    process.env.SOLANA_RPC_URL ||
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL ||
    ""
  ).trim();
}

function jupiterKey() {
  return (process.env.JUP_API_KEY || process.env.JUPITER_API_KEY || "").trim();
}

function jupiterHeaders(): Record<string, string> {
  const headers: Record<string, string> = { accept: "application/json" };
  const key = jupiterKey();
  if (key) headers["x-api-key"] = key;
  return headers;
}

function batches<T>(values: T[], size: number) {
  const out: T[][] = [];
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size));
  return out;
}

async function rpcRequest<T>(method: string, params: unknown[]): Promise<T> {
  const endpoint = rpcUrl();
  if (!endpoint) throw new Error("HELIUS_RPC_URL is not configured");
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "orbs-wallet-tokens", method, params }),
    cache: "no-store",
  });
  const payload = await response.json() as { result?: T; error?: { message?: string } };
  if (!response.ok || payload.error || payload.result === undefined) throw new Error(payload.error?.message || `Solana RPC failed (${response.status})`);
  return payload.result;
}

type RpcTokenAccounts = {
  value: Array<{
    pubkey: string;
    account: {
      data: {
        parsed?: {
          info?: {
            mint?: string;
            tokenAmount?: { amount?: string; decimals?: number; uiAmountString?: string };
          };
        };
      };
    };
  }>;
};



type JupiterMeta = Record<string, unknown> & {
  id?: string;
  address?: string;
  mint?: string;
  symbol?: string;
  name?: string;
  decimals?: number;
  icon?: string;
  logoURI?: string;
  logoUri?: string;
  tags?: string[];
  isVerified?: boolean | null;
  tokenProgram?: string;
  usdPrice?: number | null;
  audit?: { isSus?: boolean };
};

type JupiterPrice = { usdPrice?: number; decimals?: number; blockId?: number };

async function fetchMetadata(mints: string[]) {
  const map = new Map<string, JupiterMeta>();
  for (const batch of batches(mints, 100)) {
    try {
      const response = await fetch(`https://api.jup.ag/tokens/v2/search?query=${encodeURIComponent(batch.join(","))}`, {
        headers: jupiterHeaders(),
        cache: "no-store",
      });
      if (!response.ok) continue;
      const json = await response.json() as unknown;
      const items: JupiterMeta[] = Array.isArray(json)
        ? json as JupiterMeta[]
        : Array.isArray((json as { data?: unknown[] })?.data)
          ? (json as { data: JupiterMeta[] }).data
          : Array.isArray((json as { items?: unknown[] })?.items)
            ? (json as { items: JupiterMeta[] }).items
            : [];
      for (const item of items) {
        const mint = String(item.id || item.address || item.mint || "");
        if (mint) map.set(mint, item);
      }
    } catch {}
  }
  return map;
}

async function fetchPrices(mints: string[]) {
  const map = new Map<string, JupiterPrice>();
  for (const batch of batches(mints, 50)) {
    try {
      const response = await fetch(`https://api.jup.ag/price/v3?ids=${encodeURIComponent(batch.join(","))}`, {
        headers: jupiterHeaders(),
        cache: "no-store",
      });
      if (!response.ok) continue;
      const json = await response.json() as Record<string, JupiterPrice>;
      for (const [mint, price] of Object.entries(json || {})) map.set(mint, price);
    } catch {}
  }
  return map;
}

export async function getWalletSplTokens(wallet: string): Promise<WalletSplToken[]> {
  const owner = new PublicKey(wallet).toBase58();
  const accounts = await rpcRequest<RpcTokenAccounts>("getTokenAccountsByOwner", [
    owner,
    { programId: CLASSIC_SPL_TOKEN_PROGRAM },
    { encoding: "jsonParsed", commitment: "confirmed" },
  ]);

  const aggregated = new Map<string, { raw: bigint; decimals: number; balance: number }>();
  for (const row of accounts.value || []) {
    const info = row.account?.data?.parsed?.info;
    const mint = String(info?.mint || "");
    const token = info?.tokenAmount;
    const rawText = String(token?.amount || "0");
    if (!mint || !/^\d+$/.test(rawText) || rawText === "0") continue;

    // Production Anchor funding intentionally debits only the wallet's canonical
    // classic-SPL ATA. Do not aggregate auxiliary token accounts into a balance
    // that the escrow instruction cannot actually spend.
    let canonicalAta: string;
    try { canonicalAta = deriveClassicAta(new PublicKey(owner), new PublicKey(mint)).toBase58(); }
    catch { continue; }
    if (row.pubkey !== canonicalAta) continue;

    const raw = BigInt(rawText);
    if (raw <= BigInt(0)) continue;
    const decimals = Number(token?.decimals ?? 0);
    const balance = Number(token?.uiAmountString ?? 0);
    aggregated.set(mint, { raw, decimals, balance: Number.isFinite(balance) ? balance : 0 });
  }

  const mints = Array.from(aggregated.keys());
  if (!mints.length) return [];
  const [metaMap, priceMap] = await Promise.all([fetchMetadata(mints), fetchPrices(mints)]);

  const tokens = mints.map((mint): WalletSplToken => {
    const balance = aggregated.get(mint)!;
    const meta = metaMap.get(mint);
    const price = Number(priceMap.get(mint)?.usdPrice ?? meta?.usdPrice);
    const usdPrice = Number.isFinite(price) && price > 0 ? price : null;
    const usdValue = usdPrice === null ? null : balance.balance * usdPrice;
    const suspicious = Boolean(meta?.audit?.isSus) || Boolean(meta?.tags?.includes("banned"));
    const logo = [meta?.icon, meta?.logoURI, meta?.logoUri].find((value) => typeof value === "string" && /^https:\/\//i.test(value)) as string | undefined;
    const correctProgram = !meta?.tokenProgram || meta.tokenProgram === CLASSIC_SPL_TOKEN_PROGRAM;
    const eligible = usdPrice !== null && !suspicious && correctProgram;
    return {
      mint,
      symbol: String(meta?.symbol || `${mint.slice(0, 4)}…${mint.slice(-4)}`),
      name: String(meta?.name || "Unknown SPL token"),
      decimals: balance.decimals,
      balance: balance.balance,
      rawAmount: balance.raw.toString(),
      usdPrice,
      usdValue,
      logoURI: logo || null,
      verified: meta?.isVerified === true || (Array.isArray(meta?.tags) ? meta!.tags!.includes("verified") : false),
      suspicious,
      eligible,
      ineligibleReason: suspicious
        ? "Jupiter flags this token as suspicious"
        : !correctProgram
          ? "Token-2022 is not supported in Orbs V1"
          : usdPrice === null
            ? "No reliable USD price available"
            : undefined,
    };
  });

  // Holdings that would render as $0.00 are noise for a prize picker and are
  // overwhelmingly dust/spam. Keep small but genuinely valued holdings, while
  // hiding unknown-price and sub-cent balances from the creation UI entirely.
  return tokens
    .filter((token) => token.eligible && token.usdValue !== null && token.usdValue >= 0.01)
    .sort((a, b) => {
      const aEligible = a.eligible ? 1 : 0;
      const bEligible = b.eligible ? 1 : 0;
      if (aEligible !== bEligible) return bEligible - aEligible;
      const usd = (b.usdValue || 0) - (a.usdValue || 0);
      if (usd) return usd;
      return a.symbol.localeCompare(b.symbol);
    });
}
