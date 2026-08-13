"use client";

import { useMemo } from "react";
import GlassRoller from "./GlassRoller";
import { DEFAULT_GAME_STYLE } from "@/game/constants";
import { normalizeDifficulty } from "@/game/maze";
import { safeColor } from "@/game/theme";

type Props = {
  slug: string;
  difficulty?: string;
  marble?: string;
  marble2?: string;
  walls?: string;
  floor?: string;
  accent?: string;
};

export default function GameRouteClient(props: Props) {
  const difficulty = normalizeDifficulty(props.difficulty);
  const style = useMemo(() => ({
    marble: safeColor(props.marble, DEFAULT_GAME_STYLE.marble),
    marbleSecondary: safeColor(props.marble2, DEFAULT_GAME_STYLE.marbleSecondary),
    walls: safeColor(props.walls, DEFAULT_GAME_STYLE.walls),
    floor: safeColor(props.floor, DEFAULT_GAME_STYLE.floor),
    accent: safeColor(props.accent, DEFAULT_GAME_STYLE.accent),
  }), [props.accent, props.floor, props.marble, props.marble2, props.walls]);
  return <GlassRoller slug={props.slug} difficulty={difficulty} style={style} />;
}
