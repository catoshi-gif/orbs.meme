"use client";

import { useMemo, useState } from "react";
import GlassRoller from "./GlassRoller";
import { DEFAULT_GAME_STYLE, GAME_STYLE_PRESETS } from "@/game/constants";
import { normalizeDifficulty } from "@/game/maze";
import { safeColor } from "@/game/theme";
import type { DifficultyKey, GameStyle } from "@/game/types";

type Props = {
  slug: string;
  difficulty?: string;
  marble?: string;
  marble2?: string;
  walls?: string;
  floor?: string;
  accent?: string;
};

const difficultyOptions: { key: DifficultyKey; label: string; time: string }[] = [
  { key: "quick", label: "Easy", time: "~5m" },
  { key: "classic", label: "Medium", time: "~10m" },
  { key: "brutal", label: "Hard", time: "~15m" },
];

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
  const isDemo = props.slug.toLowerCase().startsWith("demo");

  const applyLab = () => {
    setDifficulty(draftDifficulty);
    setStyle({ ...draftStyle });
    setLabOpen(false);
  };

  const styleFingerprint = `${difficulty}:${style.marble}:${style.marbleSecondary}:${style.walls}:${style.floor}:${style.accent}`;

  return (
    <div className="game-route-shell">
      <GlassRoller key={styleFingerprint} slug={props.slug} difficulty={difficulty} style={style} />
      {isDemo ? (
        <>
          <button className="game-style-lab-toggle" onClick={() => setLabOpen((value) => !value)} aria-expanded={labOpen}>
            <span className="game-style-lab-swatch" style={{ background: `linear-gradient(135deg,${style.marble},${style.walls},${style.accent})` }} />
            Style lab
          </button>
          {labOpen ? (
            <aside className="game-style-lab" aria-label="Demo game style controls">
              <div className="game-style-lab-head">
                <div><span>DEMO LAB</span><strong>Make this Orb yours.</strong></div>
                <button onClick={() => setLabOpen(false)} aria-label="Close style lab">×</button>
              </div>

              <div className="game-style-lab-difficulty">
                {difficultyOptions.map((option) => (
                  <button key={option.key} className={draftDifficulty === option.key ? "active" : ""} onClick={() => setDraftDifficulty(option.key)}>
                    <strong>{option.label}</strong><small>{option.time}</small>
                  </button>
                ))}
              </div>

              <div className="game-style-lab-presets">
                {GAME_STYLE_PRESETS.map((preset) => <button key={preset.name} onClick={() => setDraftStyle({ ...preset.style })}>{preset.name}</button>)}
              </div>

              <div className="game-style-lab-colors">
                {([
                  ["marble", "Marble core"],
                  ["marbleSecondary", "Marble glow"],
                  ["walls", "Crystal rails"],
                  ["floor", "Crystal floor"],
                  ["accent", "World glow"],
                ] as [keyof GameStyle, string][]).map(([key, label]) => (
                  <label key={key}>
                    <span>{label}</span>
                    <div>
                      <input type="color" value={draftStyle[key]} onChange={(event) => setDraftStyle((current) => ({ ...current, [key]: event.target.value }))} />
                      <code>{draftStyle[key].toUpperCase()}</code>
                    </div>
                  </label>
                ))}
              </div>

              <button className="game-style-lab-apply" onClick={applyLab}>Apply + rebuild demo</button>
              <small className="game-style-lab-note">Applying restarts the local demo. Funded Orbs will freeze these settings before launch.</small>
            </aside>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
