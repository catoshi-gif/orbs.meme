"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import ConnectWallet from "@/components/ConnectWallet";
import { BONK_GAME_STYLE, DEFAULT_GAME_STYLE } from "@/game/constants";
import type { DifficultyKey, GameStyle } from "@/game/types";

const names = ["Identity", "Prize", "Game", "Launch", "Review", "Share"];
const profiles: { key: DifficultyKey; name: string; label: string; time: string }[] = [
  { key: "quick", name: "Quick", label: "Easy", time: "~5 min" },
  { key: "classic", name: "Classic", label: "Medium", time: "~10 min" },
  { key: "brutal", name: "Brutal", label: "Hard", time: "~15 min" },
];

const presetStyles: { name: string; style: GameStyle }[] = [
  { name: "Orbs", style: DEFAULT_GAME_STYLE },
  { name: "BONK", style: BONK_GAME_STYLE },
  {
    name: "Aurora",
    style: { marble: "#20E3D2", marbleSecondary: "#7EF5FF", walls: "#9A5CFF", floor: "#071126", accent: "#41B7FF" },
  },
  {
    name: "Solar",
    style: { marble: "#FF8B36", marbleSecondary: "#FFE66D", walls: "#FF4FC8", floor: "#160918", accent: "#20E3D2" },
  },
];

export default function CreateWizard() {
  const [step, setStep] = useState(0);
  const [difficulty, setDifficulty] = useState<DifficultyKey>("classic");
  const [style, setStyle] = useState<GameStyle>(DEFAULT_GAME_STYLE);
  const { connected } = useWallet();

  const previewHref = useMemo(() => {
    const q = new URLSearchParams({
      difficulty,
      marble: style.marble,
      marble2: style.marbleSecondary,
      walls: style.walls,
      floor: style.floor,
      accent: style.accent,
    });
    return `/orb/demo/play?${q.toString()}`;
  }, [difficulty, style]);

  const colorField = (key: keyof GameStyle, label: string) => (
    <div className="field game-color-field">
      <label>{label}</label>
      <div className="color-input-wrap">
        <input type="color" value={style[key]} onChange={(event) => setStyle((current) => ({ ...current, [key]: event.target.value }))} />
        <span>{style[key].toUpperCase()}</span>
      </div>
    </div>
  );

  return (
    <div className="wizard-layout">
      <aside className="wizard-nav">
        {names.map((name, i) => <button key={name} className={step === i ? "active" : ""} onClick={() => setStep(i)}>{i + 1}. {name}</button>)}
      </aside>
      <section className="wizard">
        {step === 0 ? <>
          <span className="eyebrow">Step 1 of 6</span><h2>Who is hosting?</h2>
          <p>Connect the identities that will own and promote this Orb. Wallet connection is live now; X connection arrives with the qualification backend.</p>
          <div className="fields"><div className="field full"><label>Solana wallet</label>{connected ? <div className="q-row ready"><span className="q-num">✓</span><div><strong>Wallet connected</strong><small>Ready for the future funding flow</small></div></div> : <ConnectWallet />}</div><div className="field full"><label>X account</label><button className="btn-secondary" disabled>Connect X · next phase</button></div></div>
        </> : null}

        {step === 1 ? <>
          <span className="eyebrow">Step 2 of 6</span><h2>Choose the prize.</h2>
          <p>The final build will reuse the proven SPL token picker. The displayed prize stays intact; the $1.10 Orbs fee is separate.</p>
          <div className="fields"><div className="field"><label>Token</label><input placeholder="Search supported SPL token" disabled /></div><div className="field"><label>Prize amount</label><input placeholder="$6 minimum" disabled /></div><div className="field full"><label>Fee preview</label><input value="$1.10 equivalent in selected token · integration next phase" readOnly /></div></div>
        </> : null}

        {step === 2 ? <>
          <span className="eyebrow">Step 3 of 6</span><h2>Design the game.</h2>
          <p>Choose the target solve-time band and your community palette. The same settings will be frozen into every participant&apos;s canonical game manifest.</p>
          <div className="difficulty">
            {profiles.map((profile) => <button key={profile.key} className={difficulty === profile.key ? "active" : ""} onClick={() => setDifficulty(profile.key)}><span className="difficulty-tag">{profile.label}</span><strong>{profile.name}</strong><small>{profile.time} target solve</small></button>)}
          </div>
          <div className="game-style-builder">
            <div className="game-style-preview" style={{ background: `radial-gradient(circle at 35% 30%, ${style.marbleSecondary}, ${style.marble} 30%, ${style.accent} 66%, ${style.floor})`, borderColor: style.walls }}>
              <div className="style-preview-orb" style={{ background: `radial-gradient(circle at 35% 28%, #fff, ${style.marbleSecondary} 14%, ${style.marble} 44%, ${style.accent} 72%, ${style.floor})` }} />
              <div className="style-preview-rail" style={{ background: style.walls, boxShadow: `0 0 28px ${style.walls}` }} />
              <span>LIVE PALETTE</span>
            </div>
            <div>
              <div className="game-presets">{presetStyles.map((preset) => <button key={preset.name} onClick={() => setStyle(preset.style)}>{preset.name}</button>)}</div>
              <div className="fields game-color-grid">
                {colorField("marble", "Marble core")}
                {colorField("marbleSecondary", "Marble glow")}
                {colorField("walls", "Glass rails")}
                {colorField("floor", "World / floor")}
                {colorField("accent", "Goal / accent")}
              </div>
            </div>
          </div>
          <div className="game-preview-row"><Link className="btn-primary" href={previewHref}>Play this style →</Link><span>Local deterministic prototype · no prize</span></div>
        </> : null}

        {step === 3 ? <>
          <span className="eyebrow">Step 4 of 6</span><h2>Schedule launch.</h2><p>Give the post time to cook. The final funding transaction will commit the absolute start timestamp on-chain.</p>
          <div className="fields"><div className="field"><label>Date</label><input type="date" /></div><div className="field"><label>Time</label><input type="time" /></div><div className="field full"><label>Share URL preview</label><input value="orbs.meme/orb/your-orb" readOnly /></div></div>
        </> : null}

        {step === 4 ? <>
          <span className="eyebrow">Step 5 of 6</span><h2>Review + fund.</h2><p>This is where Anchor will create the isolated prize vault, transfer the full prize, and send the separate protocol fee to the hardcoded treasury.</p>
          <div className="q-list"><div className="q-row"><span className="q-num">1</span><div><strong>Prize escrow</strong><small>Anchor integration next phase</small></div></div><div className="q-row"><span className="q-num">2</span><div><strong>Game commitment</strong><small>Glass Roller manifest now implemented locally</small></div></div><div className="q-row"><span className="q-num">3</span><div><strong>Fund Orb</strong><small>Disabled until program integration</small></div></div></div>
        </> : null}

        {step === 5 ? <>
          <span className="eyebrow">Step 6 of 6</span><h2>Share the Orb.</h2><p>After funding succeeds, this screen will reveal the permanent unique link and X share intent.</p>
          <div className="fields"><div className="field full"><label>Public URL</label><input value="orbs.meme/orb/9xL4Q" readOnly /></div><button className="btn-primary" disabled>Copy link</button><button className="btn-secondary" disabled>Post to X</button></div>
        </> : null}

        <div className="wizard-actions"><button className="btn-ghost" disabled={step === 0} onClick={() => setStep((value) => Math.max(0, value - 1))}>← Back</button><button className="btn-primary" disabled={step === names.length - 1} onClick={() => setStep((value) => Math.min(names.length - 1, value + 1))}>Continue →</button></div>
      </section>
    </div>
  );
}
