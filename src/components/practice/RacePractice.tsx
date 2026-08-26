"use client";

import RaceSandbox from "@/components/game/RaceSandbox";

const PRACTICE_STYLE = {
  marble: "#5B5CF6",
  marbleSecondary: "#20E3D2",
  walls: "#72F7FF",
  floor: "#050719",
  accent: "#9A5CFF",
};

export default function RacePractice() {
  return <div className="admin-sandbox-capture race-capture landscape" style={{marginTop:24}}>
    <RaceSandbox playerCount={8} style={PRACTICE_STYLE} seed="orbs-race-practice-v1" generation={1} />
  </div>;
}
