"use client";

import { useEffect, useMemo, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import ConnectWallet from "@/components/ConnectWallet";
import Link from "next/link";
import RefundPrizeButton from "@/components/RefundPrizeButton";

type Orb = {
  id: string;
  slug: string;
  createdAt: number;
  startsAt: number;
  endsAt: number;
  token: { symbol: string; logoURI: string | null };
  prizeTokenAmount: number;
  prizeUsd: number;
  hostX: { username: string };
  gameType?: "maze" | "arena" | "race";
};

type Activity = {
  orb: Orb;
  hosted: boolean;
  entered: boolean;
  phase: "upcoming" | "live" | "completed" | "expired";
  outcome: "entered" | "racing" | "won" | "dnf" | null;
  verifiedElapsedMs: number | null;
  winner: { wallet?: string; xUsername?: string; verifiedElapsedMs: number } | null;
  canRetrieve?: boolean;
};

function money(value: number) { return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(value); }
function amount(value: number) { return value.toLocaleString(undefined, { maximumFractionDigits: 6 }); }
function finishTime(ms: number | null) {
  if (!ms) return null;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.floor((ms % 60_000) / 1000);
  const millis = Math.floor(ms % 1000);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
}

function status(activity: Activity) {
  const gameType = activity.orb.gameType === "arena" ? "arena" : activity.orb.gameType === "race" ? "race" : "maze";
  if (activity.outcome === "won") return { label: gameType === "arena" ? "Won · ARENA" : gameType === "race" ? "Won · RACE" : `Won · ${finishTime(activity.verifiedElapsedMs)}`, tone: "won" };
  if (activity.outcome === "dnf") return { label: gameType === "arena" || gameType === "race" ? "Did not win" : "DNF", tone: "dnf" };
  if (activity.outcome === "racing") return { label: gameType === "arena" ? "Playing now" : gameType === "race" ? "Racing now" : "Racing now", tone: "live" };
  if (activity.outcome === "entered") return { label: "Entered", tone: "entered" };
  if (activity.phase === "completed") return { label: "Winner verified", tone: "complete" };
  if (activity.phase === "expired") return { label: "Expired", tone: "dnf" };
  if (activity.phase === "live") return { label: "Live now", tone: "live" };
  return { label: "Upcoming", tone: "entered" };
}

function ActivityRow({ activity, role, onRetrieved }: { activity: Activity; role: "Host" | "Player"; onRetrieved?: () => void }) {
  const { orb } = activity;
  const state = status(activity);
  const href = activity.phase === "completed" || activity.phase === "expired" ? `/orb/${orb.slug}/results` : `/orb/${orb.slug}`;
  return <div className="hosted-orb-row-wrap">
    <Link className="hosted-orb-row" href={href}>
      <div className="hosted-orb-token">{orb.token.logoURI ? <img src={orb.token.logoURI} alt="" referrerPolicy="no-referrer" /> : <span>{orb.token.symbol.slice(0, 2)}</span>}<div><strong>{amount(orb.prizeTokenAmount)} {orb.token.symbol}</strong><small>{money(orb.prizeUsd)} · hosted by @{orb.hostX.username}</small><div className="activity-tags"><em>{(orb.gameType === "arena" ? "ARENA" : orb.gameType === "race" ? "RACE" : "MAZE")}</em><em>{role}</em><em className={state.tone}>{state.label}</em></div></div></div>
      <div className="hosted-orb-launch"><strong>{activity.phase === "upcoming" ? "Launches" : activity.phase === "live" ? "Closes" : "Closed"}</strong><small>{new Date(activity.phase === "upcoming" ? orb.startsAt : orb.endsAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</small></div>
      <span className="hosted-orb-open">{activity.phase === "completed" || activity.phase === "expired" ? "Result" : "Open"} →</span>
    </Link>
    {role === "Host" && activity.canRetrieve ? <div className="hosted-orb-retrieve"><RefundPrizeButton slug={orb.slug} compact onSuccess={onRetrieved} /></div> : null}
  </div>;
}

export default function Dashboard() {
  const { connected, publicKey } = useWallet();
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wallet = publicKey?.toBase58() || "";
  const markRetrieved = (orbId: string) => setActivities((current) => current.map((activity) => activity.orb.id === orbId ? { ...activity, canRetrieve: false } : activity));

  useEffect(() => {
    setActivities([]); setError(null);
    if (!wallet) { setLoading(false); return; }
    const controller = new AbortController();
    setLoading(true);
    fetch(`/api/orbs?wallet=${encodeURIComponent(wallet)}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const text = await response.text();
        let payload: { ok?: boolean; activities?: Activity[]; error?: string };
        try { payload = JSON.parse(text) as typeof payload; }
        catch { throw new Error(`Activity service is temporarily unavailable (${response.status})`); }
        if (!response.ok || !payload.ok) throw new Error(payload.error || "Could not load your Orb activity");
        setActivities(payload.activities || []);
      })
      .catch((cause) => { if (cause instanceof Error && cause.name !== "AbortError") setError(cause.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [wallet]);

  const entered = useMemo(() => activities.filter((activity) => activity.entered), [activities]);
  const hosted = useMemo(() => activities.filter((activity) => activity.hosted), [activities]);
  const wins = useMemo(() => entered.filter((activity) => activity.outcome === "won").length, [entered]);

  if (!connected || !publicKey) return <div className="card empty"><h3>Connect your wallet.</h3><p>Hosted and entered Orbs are indexed to the wallet used for creation or qualification.</p><ConnectWallet/></div>;

  return <>
    <div className="dashboard"><div className="metric"><span>Hosted</span><strong>{hosted.length}</strong></div><div className="metric"><span>Entered</span><strong>{entered.length}</strong></div><div className="metric"><span>Wins</span><strong>{wins}</strong></div><div className="metric"><span>Wallet</span><strong>{wallet.slice(0,4)}…{wallet.slice(-4)}</strong></div></div>
    {loading ? <div className="card empty"><h3>Loading your Orb history…</h3></div> : error ? <div className="card empty"><h3>Couldn&apos;t load your activity.</h3><p>{error}</p></div> : activities.length ? <div className="activity-sections">
      <section><div className="activity-section-head"><div><span className="eyebrow">Player history</span><h2>Entered Orbs.</h2></div><small>Upcoming, live, and verified results</small></div>{entered.length ? <div className="hosted-orb-list">{entered.map((activity) => <ActivityRow activity={activity} role="Player" key={`entered:${activity.orb.id}`} />)}</div> : <div className="card activity-empty">No verified entries from this wallet yet.</div>}</section>
      <section><div className="activity-section-head"><div><span className="eyebrow">Creator history</span><h2>Hosted Orbs.</h2></div><small>One active Orb per wallet; configured operator wallets exempt</small></div>{hosted.length ? <div className="hosted-orb-list">{hosted.map((activity) => <ActivityRow activity={activity} role="Host" key={`hosted:${activity.orb.id}`} onRetrieved={() => markRetrieved(activity.orb.id)} />)}</div> : <div className="card activity-empty">No hosted Orbs from this wallet yet.</div>}</section>
    </div> : <div className="card empty"><h3>No Orb activity from this wallet yet.</h3><p>Create an Orb or verify an entry post and it will appear here automatically.</p><Link className="btn-primary" href="/create">Create an Orb</Link></div>}
  </>;
}
