"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import type { WalletSplToken } from "@/lib/walletTokens";

function usd(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "—";
  if (value >= 1000) return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}

function tokenAmount(value: number) {
  if (!Number.isFinite(value)) return "0";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 1 : 2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 10_000 ? 1 : 2)}K`;
  if (value >= 1) return value.toLocaleString(undefined, { maximumFractionDigits: 4 });
  return value.toLocaleString(undefined, { maximumSignificantDigits: 4 });
}

function TokenLogo({ token }: { token: WalletSplToken }) {
  const [broken, setBroken] = useState(false);
  if (!token.logoURI || broken) return <span className="token-logo-fallback">{token.symbol.slice(0, 1).toUpperCase()}</span>;
  return <img className="token-logo" src={token.logoURI} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} />;
}

type Props = {
  value: WalletSplToken | null;
  onChange: (token: WalletSplToken | null) => void;
};

export default function TokenPicker({ value, onChange }: Props) {
  const { publicKey, connected } = useWallet();
  const [tokens, setTokens] = useState<WalletSplToken[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const loadedWallet = useRef<string | null>(null);
  const wallet = publicKey?.toBase58() || null;

  const load = useCallback(async (force = false) => {
    if (!wallet) { setTokens([]); onChange(null); return; }
    if (!force && loadedWallet.current === wallet) return;
    setLoading(true); setError(null);
    try {
      const response = await fetch(`/api/wallet/tokens?wallet=${encodeURIComponent(wallet)}`, { cache: "no-store" });
      const payload = await response.json() as { ok?: boolean; tokens?: WalletSplToken[]; error?: string };
      if (!response.ok || !payload.ok) throw new Error(payload.error || "Could not read wallet tokens");
      const next = payload.tokens || [];
      setTokens(next);
      loadedWallet.current = wallet;
      if (value && !next.some((token) => token.mint === value.mint && token.eligible)) onChange(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read wallet tokens");
    } finally { setLoading(false); }
  }, [onChange, value, wallet]);

  useEffect(() => { void load(); }, [wallet]); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return tokens;
    return tokens.filter((token) => [token.symbol, token.name, token.mint].some((field) => field.toLowerCase().includes(needle)));
  }, [query, tokens]);

  if (!connected || !wallet) {
    return <div className="token-picker-empty"><strong>Connect your wallet first.</strong><small>Orbs only lists standard SPL tokens you actually hold.</small></div>;
  }

  return (
    <div className="token-picker">
      <button type="button" className={`token-picker-trigger ${value ? "selected" : ""}`} onClick={() => setOpen((current) => !current)}>
        {value ? <><TokenLogo token={value} /><div><strong>{value.symbol}</strong><small>{value.name}</small></div><div className="token-trigger-balance"><strong>{tokenAmount(value.balance)}</strong><small>{usd(value.usdValue)}</small></div></> : <><span className="token-picker-plus">+</span><div><strong>Select prize token</strong><small>SPL tokens currently in your wallet</small></div></>}
        <span className="token-chevron">⌄</span>
      </button>

      {open ? <div className="token-picker-popover">
        <div className="token-picker-head">
          <div><span className="eyebrow">YOUR WALLET</span><strong>SPL tokens currently in your connected wallet</strong><small>Need another token? Swap into it first, then refresh this list.</small></div>
          <button type="button" className="token-refresh" onClick={() => void load(true)} disabled={loading}>{loading ? "…" : "↻"}</button>
        </div>
        <input className="token-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter your wallet by token or mint" />
        {error ? <div className="token-picker-error">{error}</div> : null}
        <div className="token-list">
          {loading && !tokens.length ? <div className="token-list-state">Reading standard SPL balances…</div> : null}
          {!loading && !filtered.length ? <div className="token-list-state">No matching SPL tokens with a positive balance.</div> : null}
          {filtered.map((token) => <button key={token.mint} type="button" className={`token-row ${token.eligible ? "" : "disabled"}`} disabled={!token.eligible} onClick={() => { onChange(token); setOpen(false); }}>
            <TokenLogo token={token} />
            <div className="token-row-main"><div><strong>{token.symbol}</strong>{token.verified ? <span className="token-verified">✓</span> : null}</div><small>{token.name}</small><code>{token.mint.slice(0, 6)}…{token.mint.slice(-5)}</code></div>
            <div className="token-row-value"><strong>{tokenAmount(token.balance)}</strong><small>{token.usdValue === null ? token.ineligibleReason : usd(token.usdValue)}</small>{token.usdPrice !== null ? <em>{usd(token.usdPrice)} / token</em> : null}</div>
          </button>)}
        </div>
        <div className="token-picker-foot">Only the classic SPL Token Program is included. Token-2022 is intentionally excluded. Tokens without a reliable Jupiter USD price cannot fund a V1 Orb.</div>
      </div> : null}
    </div>
  );
}

export type { WalletSplToken };
