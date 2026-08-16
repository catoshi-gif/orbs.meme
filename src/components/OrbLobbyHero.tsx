"use client";

import { useEffect, useMemo, useState } from "react";
import type { PublicOrbRecord } from "@/lib/orbStore";
import { orbGameType } from "@/lib/orbGameType";
import WaitingRoomPresence from "@/components/WaitingRoomPresence";
import OrbShowcase from "@/components/OrbShowcase";

function money(value: number) { return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value); }
function amount(value: number) { return value.toLocaleString(undefined, { maximumFractionDigits: 6 }); }

export default function OrbLobbyHero({ orb, winner = false }: { orb: PublicOrbRecord; winner?: boolean }) {
  const [now, setNow] = useState(Date.now());
  const [localLaunch, setLocalLaunch] = useState("");
  const [localLaunchShort, setLocalLaunchShort] = useState("");
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    const launch = new Date(orb.startsAt);
    setLocalLaunch(new Intl.DateTimeFormat(undefined, {
      weekday: "long",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    }).format(launch));
    setLocalLaunchShort(launch.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }));
  }, [orb.startsAt]);
  const remaining = Math.max(0, orb.startsAt - now);
  const live = remaining <= 0;
  const closed = winner || now >= orb.endsAt;
  const parts = useMemo(() => {
    const total = Math.ceil(remaining / 1000);
    return { hours: Math.floor(total / 3600), minutes: Math.floor((total % 3600) / 60), seconds: total % 60 };
  }, [remaining]);
  const gameType = orbGameType(orb);
  const difficulty = gameType === "arena" ? "ARENA · live multiplayer" : orb.difficulty === "quick" ? "MAZE · Easy · ~2 minute target" : orb.difficulty === "classic" ? "MAZE · Medium · ~4 minute target" : "MAZE · Hard · ~6 minute target";

  return <section className="card prize-hero real-orb-hero">
    {!closed ? <OrbShowcase style={orb.style} compact background className="waiting-orb-showcase" /> : null}
    <div className="orb-top"><div className="hostline">{orb.hostX.profileImageUrl ? <img className="host-avatar" src={orb.hostX.profileImageUrl} alt="" referrerPolicy="no-referrer" /> : <span className="avatar" />}Hosted by @{orb.hostX.username}<span className="game-type-chip">{gameType.toUpperCase()}</span></div><span className={`pill ${live && !closed ? "live" : ""}`}>{closed ? (winner ? "CLEARED" : "EXPIRED") : live ? "LIVE" : "SEALED"}</span></div>
    <div className="prize-token-line">{orb.token.logoURI ? <img src={orb.token.logoURI} alt="" referrerPolicy="no-referrer" /> : null}<div><div className="prize-big">{amount(orb.prizeTokenAmount)} {orb.token.symbol}</div><div className="muted">≈ {money(orb.prizeUsd)} · {difficulty}</div></div></div>
    {closed ? <>
      <div className="live-launch-panel closed"><span>{winner ? (gameType === "arena" ? "ARENA WINNER VERIFIED" : "FIRST FINISH VERIFIED") : "COMPETITION ENDED"}</span><strong>{winner ? "The winner lock is secured and the result is ready." : "The six-hour competition window closed without a verified winner."}</strong><a className="btn-primary" href={`/orb/${orb.slug}/results`}>View result →</a></div>
      <div className="commitment-card"><span>SEALED GAME COMMITMENT</span><code>{orb.commitment}</code><small>{gameType === "maze" ? "No maze seed, geometry, path or checkpoints are returned before launch." : "Arena configuration is committed before launch."}</small></div>
    </> : <WaitingRoomPresence slug={orb.slug} gameType={gameType} details={live ? <>
      <div className="live-launch-panel"><span>THE ORB IS LIVE</span><strong>{gameType === "arena" ? "ARENA is live. Enter with your registered Orb." : "Same maze. Same start. First verified finish wins."}</strong><a className="btn-primary" href="#qualify">Register to enter →</a></div>
      <div className="commitment-card"><span>SEALED GAME COMMITMENT</span><code>{orb.commitment}</code><small>{gameType === "maze" ? "No maze seed, geometry, path or checkpoints are returned before launch." : "Arena configuration is committed before launch."}</small></div>
    </> : <>
      <div className="countdown"><div><strong>{String(parts.hours).padStart(2, "0")}</strong><span>Hours</span></div><div><strong>{String(parts.minutes).padStart(2, "0")}</strong><span>Minutes</span></div><div><strong>{String(parts.seconds).padStart(2, "0")}</strong><span>Seconds</span></div><div><strong>{localLaunchShort || "…"}</strong><span>Launch</span></div></div>
      <div className="local-launch-time"><span>YOUR LOCAL START TIME</span><strong>{localLaunch || "Detecting your local time…"}</strong><small>Set an alarm and come back before launch so you are registered and ready.</small></div>
      <div className="commitment-card"><span>SEALED GAME COMMITMENT</span><code>{orb.commitment}</code><small>{gameType === "maze" ? "No maze seed, geometry, path or checkpoints are returned before launch." : "Arena configuration is committed before launch."}</small></div>
    </>} />}
    <div className="style-swatches" aria-label="Host game colors">{Object.entries(orb.style).map(([key, color]) => <span key={key} title={`${key}: ${color}`} style={{background: color}} />)}</div>
  </section>;
}
