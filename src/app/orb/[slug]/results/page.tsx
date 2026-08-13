import Image from "next/image";
import Link from "next/link";
import { getPublicOrb } from "@/lib/orbStore";
import { getWinner } from "@/lib/upstashWinner";

export const dynamic = "force-dynamic";

function formatTime(ms?: number) {
  if (!ms || !Number.isFinite(ms)) return "—";
  const seconds = ms / 1000;
  const min = Math.floor(seconds / 60);
  const sec = Math.floor(seconds % 60);
  const millis = Math.floor(ms % 1000);
  return `${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
}

function amount(value: number) { return value.toLocaleString(undefined, { maximumFractionDigits: 6 }); }

export default async function Page({params}:{params:Promise<{slug:string}>}) {
  const {slug}=await params;
  const orb = await getPublicOrb(slug);
  const winner = orb ? await getWinner(orb.id) : await getWinner(slug);
  const expired = Boolean(orb && Date.now() >= orb.endsAt && !winner);
  const prize = orb ? `${amount(orb.prizeTokenAmount)} ${orb.token.symbol}` : "25M BONK";
  return <div className="page"><div className="container"><div className="result">
    <Image src="/orbs-logo-256.png" width={256} height={256} alt=""/>
    <span className="eyebrow">{winner ? "Orb cleared" : expired ? "Orb expired" : "Orb result"}</span>
    <h1>{winner ? "The first light was found." : expired ? "The race window closed." : "The race is still open."}</h1>
    <p className="muted">{winner ? <>{winner.xUsername ? <><strong>@{winner.xUsername}</strong> · </> : null}{winner.wallet ? <><code>{winner.wallet.slice(0,6)}…{winner.wallet.slice(-6)}</code> · </> : null}server-verified deterministic finish.</> : expired ? <>No verified player finished before this Orb&apos;s six-hour expiry. Qualified entrants are recorded as DNF.</> : <>Winner state for <strong>{slug}</strong>. The prize remains reserved until there is one server-verified first finish.</>}</p>
    <div className="result-prize gradient-text">{prize}</div>
    <button className="btn-primary" disabled>{winner ? "Claim prize · Turnkey + Anchor integration next" : expired ? "Expired · refund path pending Anchor" : "Waiting for a verified winner"}</button>
    <div className="metrics"><div className="metric"><span>Finish time</span><strong>{formatTime(winner?.verifiedElapsedMs)}</strong></div><div className="metric"><span>Replay proof</span><strong>{winner?.replayHash ? winner.replayHash.slice(0,12).toUpperCase() : "—"}</strong></div><div className="metric"><span>Status</span><strong>{winner ? "Winner reserved" : expired ? "Expired / no winner" : "Live / pending"}</strong></div></div>
    <div className="hero-actions" style={{justifyContent:"center"}}><Link className="btn-secondary" href="/create">Create an Orb</Link><Link className="btn-ghost" href={`/orb/${slug}`}>Back to Orb →</Link></div>
  </div></div></div>;
}
