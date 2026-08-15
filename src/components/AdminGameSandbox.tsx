"use client";

import { useMemo, useRef, useState } from "react";
import GlassRoller from "@/components/game/GlassRoller";
import { GAME_STYLE_PRESETS } from "@/game/constants";
import { generateGameManifest } from "@/game/maze";
import type { DifficultyKey, GameStyle } from "@/game/types";

type CaptureFormat = "landscape" | "square" | "portrait";

type Draft = {
  difficulty: DifficultyKey;
  seed: string;
  marble: string;
  marbleSecondary: string;
  walls: string;
  floor: string;
  accent: string;
};

type ActiveDemo = {
  difficulty: DifficultyKey;
  seed: string;
  style: GameStyle;
  generation: number;
};

const EMPTY: Draft = {
  difficulty: "quick",
  seed: "",
  marble: "",
  marbleSecondary: "",
  walls: "",
  floor: "",
  accent: "",
};

const HEX = /^#[0-9a-fA-F]{6}$/;

function randomSeed() {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

function hslToHex(h: number, s: number, l: number) {
  s /= 100; l /= 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs((h / 60) % 2 - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r,g,b]=[c,x,0]; else if (h < 120) [r,g,b]=[x,c,0]; else if (h < 180) [r,g,b]=[0,c,x]; else if (h < 240) [r,g,b]=[0,x,c]; else if (h < 300) [r,g,b]=[x,0,c]; else [r,g,b]=[c,0,x];
  return `#${[r,g,b].map(v=>Math.round((v+m)*255).toString(16).padStart(2,"0")).join("").toUpperCase()}`;
}

function randomStyle(): GameStyle {
  const hue = Math.floor(Math.random() * 360);
  const second = (hue + 55 + Math.floor(Math.random() * 75)) % 360;
  const accent = (hue + 145 + Math.floor(Math.random() * 75)) % 360;
  return {
    marble: hslToHex(hue, 82, 58),
    marbleSecondary: hslToHex(second, 88, 66),
    walls: hslToHex((hue + 28) % 360, 78, 56),
    floor: hslToHex((hue + 225) % 360, 46, 6),
    accent: hslToHex(accent, 88, 64),
  };
}

export default function AdminGameSandbox() {
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [active, setActive] = useState<ActiveDemo | null>(null);
  const [format, setFormat] = useState<CaptureFormat>("landscape");
  const captureRef = useRef<HTMLDivElement>(null);

  const colorsValid = [draft.marble, draft.marbleSecondary, draft.walls, draft.floor, draft.accent].every(value => HEX.test(value));
  const ready = colorsValid && draft.seed.trim().length >= 2;

  const manifest = useMemo(() => {
    if (!active) return null;
    return generateGameManifest(`marketing:${active.seed}`, active.difficulty, active.style);
  }, [active]);

  const update = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft(current => ({ ...current, [key]: value }));
  const loadStyle = (style: GameStyle) => setDraft(current => ({ ...current, ...style }));
  const generate = () => {
    if (!ready) return;
    setActive({
      difficulty: draft.difficulty,
      seed: draft.seed.trim(),
      style: {
        marble: draft.marble,
        marbleSecondary: draft.marbleSecondary,
        walls: draft.walls,
        floor: draft.floor,
        accent: draft.accent,
      },
      generation: Date.now(),
    });
  };
  const randomizeAll = () => {
    const style = randomStyle();
    setDraft(current => ({ ...current, ...style, seed: randomSeed() }));
  };
  const fullscreen = async () => {
    try { await captureRef.current?.requestFullscreen?.({ navigationUI: "hide" }); } catch { /* screen capture can still use the embedded frame */ }
  };

  return (
    <section className="admin-game-sandbox">
      <div className="admin-sandbox-heading">
        <div>
          <span className="eyebrow">Marketing studio</span>
          <h2>Game creation sandbox</h2>
          <p>Generate real Orbs mazes with the production engine for screen captures. Nothing here creates an Orb, writes to Redis, touches wallets, or participates in a prize race.</p>
        </div>
        <span className="admin-sandbox-local">ADMIN ONLY · LOCAL DEMO</span>
      </div>

      <div className="admin-sandbox-builder card">
        <div className="admin-sandbox-section">
          <span className="admin-sandbox-label">01 · Maze</span>
          <div className="admin-sandbox-difficulties">
            {(["quick","classic","brutal"] as DifficultyKey[]).map(key => (
              <button type="button" className={draft.difficulty === key ? "active" : ""} key={key} onClick={() => update("difficulty", key)}>
                <strong>{key === "quick" ? "Quick" : key === "classic" ? "Classic" : "Brutal"}</strong>
                <small>{key === "quick" ? "~2 min" : key === "classic" ? "~4 min" : "~6 min"}</small>
              </button>
            ))}
          </div>
          <div className="admin-sandbox-seed-row">
            <label><span>Creative seed</span><input value={draft.seed} maxLength={48} onChange={event => update("seed", event.target.value.replace(/[^a-zA-Z0-9_-]/g, ""))} placeholder="e.g. caturday-jup-01" /></label>
            <button type="button" className="btn-secondary" onClick={() => update("seed", randomSeed())}>Random seed</button>
          </div>
        </div>

        <div className="admin-sandbox-section">
          <span className="admin-sandbox-label">02 · World palette</span>
          <div className="admin-sandbox-presets">
            {GAME_STYLE_PRESETS.map(preset => <button type="button" key={preset.name} onClick={() => loadStyle(preset.style)}>{preset.name}</button>)}
            <button type="button" onClick={randomizeAll}>Surprise me ✦</button>
          </div>
          <div className="admin-sandbox-colors">
            {([
              ["marble","Marble"], ["marbleSecondary","Marble glow"], ["walls","Crystal walls"], ["floor","Crystal floor"], ["accent","Accent / rings"],
            ] as const).map(([key,label]) => (
              <label key={key}>
                <span>{label}</span>
                <div className="admin-sandbox-color-control">
                  <input type="color" value={HEX.test(draft[key]) ? draft[key] : "#5B5CF6"} onChange={event => update(key, event.target.value.toUpperCase())} />
                  <input value={draft[key]} maxLength={7} onChange={event => update(key, event.target.value.toUpperCase())} placeholder="#000000" />
                </div>
              </label>
            ))}
          </div>
        </div>

        <div className="admin-sandbox-section admin-sandbox-output-controls">
          <div>
            <span className="admin-sandbox-label">03 · Capture frame</span>
            <div className="admin-sandbox-formats">
              {(["landscape","square","portrait"] as CaptureFormat[]).map(value => <button type="button" className={format === value ? "active" : ""} key={value} onClick={() => setFormat(value)}>{value === "landscape" ? "16:9" : value === "square" ? "1:1" : "9:16"}</button>)}
            </div>
          </div>
          <div className="admin-sandbox-actions">
            <button type="button" className="btn-secondary" onClick={randomizeAll}>Randomize</button>
            <button type="button" className="btn-primary" disabled={!ready} onClick={generate}>{active ? "Generate new take →" : "Generate demo →"}</button>
          </div>
        </div>
        {!ready ? <small className="admin-sandbox-hint">Choose or enter all five colors and add a seed before the game engine starts.</small> : null}
      </div>

      {active && manifest ? (
        <div className="admin-sandbox-stage-shell">
          <div className="admin-sandbox-stage-toolbar">
            <div><strong>{active.difficulty.toUpperCase()}</strong><span>seed · {active.seed}</span><span>{manifest.path.length} path cells · {manifest.checkpoints.length} rings</span></div>
            <button type="button" className="btn-secondary" onClick={() => void fullscreen()}>Fullscreen capture ↗</button>
          </div>
          <div ref={captureRef} className={`admin-sandbox-capture ${format}`}>
            <GlassRoller
              key={`${active.generation}:${format}`}
              slug="MARKETING-DEMO"
              difficulty={active.difficulty}
              style={active.style}
              manifestOverride={manifest}
              sandboxMode
            />
          </div>
        </div>
      ) : (
        <div className="admin-sandbox-empty card">
          <div className="admin-sandbox-empty-orb" />
          <strong>Nothing is rendering yet.</strong>
          <span>Build a palette + seed above, then generate a real maze when you are ready to record.</span>
        </div>
      )}
    </section>
  );
}
