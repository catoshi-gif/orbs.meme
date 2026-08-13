"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import GlassRoller from "./GlassRoller";
import { DEFAULT_GAME_STYLE, GAME_STYLE_PRESETS } from "@/game/constants";
import { normalizeDifficulty } from "@/game/maze";
import { safeColor } from "@/game/theme";
import type { DifficultyKey, GameManifest, GameStyle } from "@/game/types";

type Props = {
  slug: string;
  wallet?: string;
  difficulty?: string;
  marble?: string;
  marble2?: string;
  walls?: string;
  floor?: string;
  accent?: string;
};

type PublicOrb = {
  id: string;
  slug: string;
  startsAt: number;
  endsAt: number;
  commitment: string;
  difficulty: DifficultyKey;
  style: GameStyle;
  hostX: { username: string };
};

type SessionPayload = {
  ok?: boolean;
  error?: string;
  startsAt?: number;
  session?: string;
  manifest?: GameManifest;
  manifestHash?: string;
};

const difficultyOptions: { key: DifficultyKey; label: string; time: string }[] = [
  { key: "quick", label: "Easy", time: "~5m" },
  { key: "classic", label: "Medium", time: "~10m" },
  { key: "brutal", label: "Hard", time: "~15m" },
];

function formatCountdown(ms: number) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export default function GameRouteClient(props: Props) {
  const initialDifficulty = useMemo(() => normalizeDifficulty(props.difficulty), [props.difficulty]);
  const initialStyle = useMemo<GameStyle>(() => ({
    marble: safeColor(props.marble, DEFAULT_GAME_STYLE.marble),
    marbleSecondary: safeColor(props.marble2, DEFAULT_GAME_STYLE.marbleSecondary),
    walls: safeColor(props.walls, DEFAULT_GAME_STYLE.walls),
    floor: safeColor(props.floor, DEFAULT_GAME_STYLE.floor),
    accent: safeColor(props.accent, DEFAULT_GAME_STYLE.accent),
  }), [props.accent, props.floor, props.marble, props.marble2, props.walls]);

  const [difficulty, setDifficulty] = useState<DifficultyKey>(initialDifficulty);
  const [style, setStyle] = useState<GameStyle>(initialStyle);
  const [draftDifficulty, setDraftDifficulty] = useState<DifficultyKey>(initialDifficulty);
  const [draftStyle, setDraftStyle] = useState<GameStyle>(initialStyle);
  const [labOpen, setLabOpen] = useState(false);
  const [orb, setOrb] = useState<PublicOrb | null | undefined>(undefined);
  const [manifest, setManifest] = useState<GameManifest | null>(null);
  const [manifestHash, setManifestHash] = useState<string | null>(null);
  const [competitiveSession, setCompetitiveSession] = useState<string | null>(null);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [sessionLoading, setSessionLoading] = useState(false);
  const [now, setNow] = useState(Date.now());

  const isDemo = orb === null || (orb === undefined && props.slug.toLowerCase().startsWith("demo"));

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/orbs/${encodeURIComponent(props.slug)}`, { cache: "no-store" })
      .then(async (response) => {
        if (response.status === 404) return null;
        const payload = await response.json() as { orb?: PublicOrb; error?: string };
        if (!response.ok || !payload.orb) throw new Error(payload.error || "Could not load Orb");
        return payload.orb;
      })
      .then((record) => { if (!cancelled) setOrb(record); })
      .catch((error) => { if (!cancelled) { setOrb(null); if (!props.slug.toLowerCase().startsWith("demo")) setSessionError(error instanceof Error ? error.message : "Could not load Orb"); } });
    return () => { cancelled = true; };
  }, [props.slug]);

  useEffect(() => {
    if (!orb) return;
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, [orb]);

  const requestSession = useCallback(async () => {
    if (!orb || !props.wallet || Date.now() < orb.startsAt || sessionLoading || competitiveSession) return;
    setSessionLoading(true); setSessionError(null);
    try {
      const response = await fetch(`/api/orbs/${encodeURIComponent(props.slug)}/session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet: props.wallet }),
        cache: "no-store",
      });
      const payload = await response.json() as SessionPayload;
      if (!response.ok || !payload.ok || !payload.session || !payload.manifest || !payload.manifestHash) throw new Error(payload.error || "Could not enter this Orb");
      setCompetitiveSession(payload.session);
      setManifest(payload.manifest);
      setManifestHash(payload.manifestHash);
      setDifficulty(payload.manifest.difficulty);
      setStyle(payload.manifest.style);
    } catch (error) {
      setSessionError(error instanceof Error ? error.message : "Could not enter this Orb");
    } finally { setSessionLoading(false); }
  }, [competitiveSession, orb, props.slug, props.wallet, sessionLoading]);

  useEffect(() => {
    if (!orb || now < orb.startsAt || competitiveSession || sessionLoading) return;
    void requestSession();
  }, [competitiveSession, now, orb, requestSession, sessionLoading]);

  const applyLab = () => {
    setDifficulty(draftDifficulty);
    setStyle({ ...draftStyle });
    setLabOpen(false);
  };

  const styleFingerprint = `${difficulty}:${style.marble}:${style.marbleSecondary}:${style.walls}:${style.floor}:${style.accent}`;

  if (orb === undefined && !props.slug.toLowerCase().startsWith("demo")) {
    return <div className="game-route-shell game-jit-state"><div className="game-loader-orb" /><span className="eyebrow">Opening Orb</span><h1>Checking the sealed game…</h1></div>;
  }

  if (orb) {
    if (!props.wallet) return <div className="game-route-shell game-jit-state"><span className="eyebrow">Competitive Orb</span><h1>Enter through the lobby.</h1><p>Your qualified wallet must be bound to the competitive session before the maze can load.</p><Link className="btn-primary" href={`/orb/${props.slug}`}>Return to Orb →</Link></div>;
    if (now < orb.startsAt) return <div className="game-route-shell game-jit-state"><span className="eyebrow">Maze sealed</span><h1>{formatCountdown(orb.startsAt - now)}</h1><p>The seed, path, walls and checkpoints remain unavailable until the host&apos;s launch time.</p><div className="sealed-orb game-jit-commitment"><span>GAME COMMITMENT</span><code>{orb.commitment}</code></div></div>;
    if (now >= orb.endsAt) return <div className="game-route-shell game-jit-state"><span className="eyebrow">Competition closed</span><h1>This Orb has expired.</h1><p>The six-hour race window ended. New sessions and finishes are closed.</p><Link className="btn-primary" href={`/orb/${props.slug}/results`}>View result →</Link></div>;
    if (!manifest || !competitiveSession) return <div className="game-route-shell game-jit-state"><div className="game-loader-orb" /><span className="eyebrow">Orb is live</span><h1>{sessionLoading ? "Issuing your session…" : "Preparing the canonical maze…"}</h1><p>{sessionError || "Your X follow, wallet proof, human check and verified entry post are being bound to this exact game manifest."}</p>{sessionError ? <div className="game-ready-actions"><button className="btn-primary" onClick={() => void requestSession()}>Retry entry</button><Link className="btn-secondary" href={`/orb/${props.slug}`}>Qualification</Link></div> : null}</div>;
  }

  return (
    <div className="game-route-shell">
      <GlassRoller
        key={manifest ? `${manifest.manifestId}:${props.wallet}` : styleFingerprint}
        slug={props.slug}
        difficulty={manifest?.difficulty || difficulty}
        style={manifest?.style || style}
        manifestOverride={manifest || undefined}
        competitiveSession={competitiveSession || undefined}
        wallet={props.wallet}
        manifestHash={manifestHash || undefined}
      />
      {isDemo ? (
        <>
          <button className="game-style-lab-toggle" onClick={() => setLabOpen((value) => !value)} aria-expanded={labOpen}>
            <span className="game-style-lab-swatch" style={{ background: `linear-gradient(135deg,${style.marble},${style.walls},${style.accent})` }} />
            Style lab
          </button>
          {labOpen ? (
            <aside className="game-style-lab" aria-label="Demo game style controls">
              <div className="game-style-lab-head"><div><span>DEMO LAB</span><strong>Make this Orb yours.</strong></div><button onClick={() => setLabOpen(false)} aria-label="Close style lab">×</button></div>
              <div className="game-style-lab-difficulty">{difficultyOptions.map((option) => <button key={option.key} className={draftDifficulty === option.key ? "active" : ""} onClick={() => setDraftDifficulty(option.key)}><strong>{option.label}</strong><small>{option.time}</small></button>)}</div>
              <div className="game-style-lab-presets">{GAME_STYLE_PRESETS.map((preset) => <button key={preset.name} onClick={() => setDraftStyle({ ...preset.style })}>{preset.name}</button>)}</div>
              <div className="game-style-lab-colors">{([ ["marble", "Marble core"], ["marbleSecondary", "Marble glow"], ["walls", "Crystal rails"], ["floor", "Crystal floor"], ["accent", "World glow"] ] as [keyof GameStyle, string][]).map(([key, label]) => <label key={key}><span>{label}</span><div><input type="color" value={draftStyle[key]} onChange={(event) => setDraftStyle((current) => ({ ...current, [key]: event.target.value }))} /><code>{draftStyle[key].toUpperCase()}</code></div></label>)}</div>
              <button className="game-style-lab-apply" onClick={applyLab}>Apply + rebuild demo</button><small className="game-style-lab-note">Applying restarts the local demo. Funded Orbs freeze these settings before launch.</small>
            </aside>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
