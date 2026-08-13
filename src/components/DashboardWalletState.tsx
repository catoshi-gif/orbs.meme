"use client";

import { useEffect, useMemo, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import ConnectWallet from "@/components/ConnectWallet";
import Link from "next/link";

type HostedOrb = {
  id: string;
  slug: string;
  createdAt: number;
  startsAt: number;
  status: string;
  token: { symbol: string; logoURI: string | null };
  prizeTokenAmount: number;
  prizeUsd: number;
  difficulty: string;
  hostX: { username: string };
};

function money(value: number) { return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(value); }
function amount(value: number) { return value.toLocaleString(undefined, { maximumFractionDigits: 6 }); }

export default function Dashboard() {
  const { connected, publicKey } = useWallet();
  const [orbs, setOrbs] = useState<HostedOrb[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wallet = publicKey?.toBase58() || "";

  useEffect(() => {
    setOrbs([]); setError(null);
    if (!wallet) { setLoading(false); return; }
    const controller = new AbortController();
    setLoading(true);
    fetch(`/api/orbs?hostWallet=${encodeURIComponent(wallet)}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json() as { ok?: boolean; orbs?: HostedOrb[]; error?: string };
        if (!response.ok || !payload.ok) throw new Error(payload.error || "Could not load your Orbs");
        setOrbs(payload.orbs || []);
      })
      .catch((cause) => { if (cause instanceof Error && cause.name !== "AbortError") setError(cause.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [wallet]);

  const upcoming = useMemo(() => orbs.filter((orb) => orb.startsAt > Date.now()).length, [orbs]);

  if (!connected || !publicKey) return <div className="card empty"><h3>Connect your wallet.</h3><p>Your hosted Orbs are indexed to the wallet that created them.</p><ConnectWallet/></div>;

  return <>
    <div className="dashboard"><div className="metric"><span>Hosted</span><strong>{orbs.length}</strong></div><div className="metric"><span>Upcoming</span><strong>{upcoming}</strong></div><div className="metric"><span>Wins</span><strong>0</strong></div><div className="metric"><span>Wallet</span><strong>{wallet.slice(0,4)}…{wallet.slice(-4)}</strong></div></div>
    {loading ? <div className="card empty"><h3>Loading your Orbs…</h3></div> : error ? <div className="card empty"><h3>Couldn&apos;t load your Orbs.</h3><p>{error}</p></div> : orbs.length ? <div className="hosted-orb-list">{orbs.map((orb) => <Link className="hosted-orb-row" href={`/orb/${orb.slug}`} key={orb.id}><div className="hosted-orb-token">{orb.token.logoURI ? <img src={orb.token.logoURI} alt="" referrerPolicy="no-referrer" /> : <span>{orb.token.symbol.slice(0, 2)}</span>}<div><strong>{amount(orb.prizeTokenAmount)} {orb.token.symbol}</strong><small>{money(orb.prizeUsd)} · @{orb.hostX.username}</small></div></div><div className="hosted-orb-launch"><strong>{orb.startsAt > Date.now() ? "Upcoming" : "Launched"}</strong><small>{new Date(orb.startsAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</small></div><span className="hosted-orb-open">Open →</span></Link>)}</div> : <div className="card empty"><h3>No Orbs from this wallet yet.</h3><p>Create one and it will appear here as soon as it is sealed.</p><Link className="btn-primary" href="/create">Create an Orb</Link></div>}
  </>;
}
