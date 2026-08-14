import type { CSSProperties } from "react";
import type { GameStyle } from "@/game/types";

const DEFAULT_STYLE: GameStyle = {
  marble: "#7B61FF",
  marbleSecondary: "#20E3D2",
  walls: "#8EA4FF",
  floor: "#071125",
  accent: "#20E3D2",
};

type CinematicVars = CSSProperties & {
  "--cin-marble": string;
  "--cin-marble-2": string;
  "--cin-wall": string;
  "--cin-floor": string;
  "--cin-accent": string;
};

export default function OrbCinematic({
  style = DEFAULT_STYLE,
  variant = "hero",
  urgency = "calm",
}: {
  style?: GameStyle;
  variant?: "hero" | "ambient";
  urgency?: "calm" | "warm" | "final";
}) {
  const vars: CinematicVars = {
    "--cin-marble": style.marble,
    "--cin-marble-2": style.marbleSecondary,
    "--cin-wall": style.walls,
    "--cin-floor": style.floor,
    "--cin-accent": style.accent,
  };

  return <div className={`orb-cinematic orb-cinematic-${variant} orb-cinematic-${urgency}`} style={vars} aria-hidden="true">
    <div className="cinematic-sky"><i/><i/><i/></div>
    <div className="cinematic-mountains cinematic-mountains-back" />
    <div className="cinematic-mountains cinematic-mountains-front" />
    <div className="cinematic-floor" />
    <div className="cinematic-grid" />
    <div className="cinematic-maze">
      <span className="cin-rail r1"/><span className="cin-rail r2"/><span className="cin-rail r3"/><span className="cin-rail r4"/>
      <span className="cin-rail r5"/><span className="cin-rail r6"/><span className="cin-rail r7"/><span className="cin-rail r8"/>
      <span className="cin-rail r9"/><span className="cin-rail r10"/><span className="cin-rail r11"/><span className="cin-rail r12"/>
      <span className="cin-ring ring1"/><span className="cin-ring ring2"/><span className="cin-ring ring3"/><span className="cin-ring ring4"/>
      <span className="cin-finish"><b/><b/></span>
      <span className="cin-orb"><i/></span>
      <span className="cin-orb-glow"/>
    </div>
    <div className="cinematic-vignette" />
    {variant === "hero" ? <div className="cinematic-caption"><span>GAMEPLAY GLIMPSE</span><strong>Cross every ring. Find the finish.</strong></div> : null}
  </div>;
}
