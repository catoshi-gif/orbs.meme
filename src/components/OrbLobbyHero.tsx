"use client";

import { useEffect, useMemo, useState } from "react";
import type { PublicOrbRecord } from "@/lib/orbStore";

function money(value: number) { return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value); }
function amount(value: number) { return value.toLocaleString(undefined, { maximumFractionDigits: 6 }); }

export default function OrbLobbyHero({ orb, winner = false }: { orb: PublicOrbRecord; winner?: boolean }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const id = window.setInterval(() => setNow(Date.now()), 250); return () => clearInterval(id); }, []);
  const remaining = Math.max(0, orb.startsAt - now);
  const live = remaining <= 0;
  const closed = winner || now >= orb.endsAt;
  const parts = useMemo(() => {
    const total = Math.ceil(remaining / 1000);
    return { hours: Math.floor(total / 3600), minutes: Math.floor((total % 3600) / 60), seconds: total % 60 };
  }, [remaining]);
  const difficulty = orb.difficulty === "quick" ? "Easy · ~2 minute target" : orb.difficulty === "classic" ? "Medium · ~4 minute target" : "Hard · ~6 minute target";

  return <section className="card prize-hero real-orb-hero">
    <div className="orb-top"><div className="hostline">{orb.hostX.profileImageUrl ? <img className="host-avatar" src={orb.hostX.profileImageUrl} alt="" referrerPolicy="no-referrer" /> : <span className="avatar" />}Hosted by @{orb.hostX.username}</div><span className={`pill ${live && !closed ? "live" : ""}`}>{closed ? (winner ? "CLEARED" : "EXPIRED") : live ? "LIVE" : "SEALED TEST"}</span></div>
    <div className="prize-token-line">{orb.token.logoURI ? <img src={orb.token.logoURI} alt="" referrerPolicy="no-referrer" /> : null}<div><div className="prize-big">{amount(orb.prizeTokenAmount)} {orb.token.symbol}</div><div className="muted">≈ {money(orb.prizeUsd)} · {difficulty}</div></div></div>
    {closed ? <div className="live-launch-panel closed"><span>{winner ? "FIRST FINISH VERIFIED" : "COMPETITION ENDED"}</span><strong>{winner ? "The winner lock is secured and the result is ready." : "The six-hour race window closed without a verified winner."}</strong><a className="btn-primary" href={`/orb/${orb.slug}/results`}>View result →</a></div> : live ? <div className="live-launch-panel"><span>THE ORB IS LIVE</span><strong>Same maze. Same start. First verified finish wins.</strong><a className="btn-primary" href="#qualify">Qualify to enter →</a></div> : <div className="countdown"><div><strong>{String(parts.hours).padStart(2, "0")}</strong><span>Hours</span></div><div><strong>{String(parts.minutes).padStart(2, "0")}</strong><span>Minutes</span></div><div><strong>{String(parts.seconds).padStart(2, "0")}</strong><span>Seconds</span></div><div><strong>{new Date(orb.startsAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</strong><span>Launch</span></div></div>}
    <div className="commitment-card"><span>SEALED GAME COMMITMENT</span><code>{orb.commitment}</code><small>No maze seed, geometry, path or checkpoints are returned before launch.</small></div>
    <div className="style-swatches" aria-label="Host game colors">{Object.entries(orb.style).map(([key, color]) => <span key={key} title={`${key}: ${color}`} style={{background: color}} />)}</div>
  </section>;
}
