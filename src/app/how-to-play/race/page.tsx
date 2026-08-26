import Link from "next/link";
import RacePractice from "@/components/practice/RacePractice";

export const metadata = { title: "How to play RACE" };

export default function RaceHowToPlay() {
  return <div className="page"><div className="container how-play-page">
    <Link className="how-play-back" href="/how-it-works">← How Orbs works</Link>
    <span className="eyebrow">RACE · HOW TO PLAY</span>
    <h1 className="page-title">Hold the line. Use the air. <span className="gradient-text">Finish first.</span></h1>
    <p className="page-intro">Practice the same local RACE handling here before a live Orb. Prize-bearing races use an authoritative Railway simulation, a sealed procedural course, and an automatically synchronized start.</p>

    <RacePractice />

    <div className="how-play-device-copy">
      <section><span>DESKTOP</span><h2>Gas + steering.</h2><p><strong>W / ↑</strong> holds the gas. <strong>A / D or ← / →</strong> steer. <strong>S / ↓</strong> brakes. <strong>Space</strong> always attempts a jump and also uses your loaded item.</p></section>
      <section><span>MOBILE</span><h2>GO + touch steering.</h2><p>Hold <strong>GO</strong> to accelerate, steer with the on-screen control, and use the large action button to jump or jump + use an item.</p></section>
    </div>

    <div className="how-play-rules arena-rules">
      <div><b>3</b><h3>Three laps</h3><p>The third valid crossing of START / FINISH ends your race. The first authoritative three-lap finisher wins.</p></div>
      <div><b>01</b><h3>Grid priority</h3><p>Complete registration early. Starting positions are ordered by the server-recorded time registration was completed; late entrants begin farther back.</p></div>
      <div><b>3→2</b><h3>Perfect start</h3><p>Tap gas during the small 3-to-2 countdown window for a modest server-verified launch boost. Holding too early gives no bonus.</p></div>
      <div><b>↑</b><h3>Jump</h3><p>Jump whenever you want. Air steering is deliberately limited, so choose your takeoff line before leaving the road.</p></div>
      <div><b>⚡</b><h3>Pulse Lance</h3><p>A fast track-following skill shot. Line up the racer ahead before firing; it is not a homing weapon.</p></div>
      <div><b>●</b><h3>Bomb</h3><p>Drop it behind you. An armed hit kills most of the victim&apos;s speed and adds a physical blast impulse.</p></div>
      <div><b>»</b><h3>Turbo</h3><p>Store a personal speed charge and trigger it with your action press for a short burst.</p></div>
      <div><b>☁</b><h3>Nimbus rescue</h3><p>Fall off and Nimbus returns you to a verified safe road anchor after three seconds. Falling can never become a shortcut.</p></div>
      <div><b>↓</b><h3>Gravity Dive</h3><p>Every procedural course contains a randomized massive downhill/free-fall sequence in addition to the Orbital Plunge.</p></div>
      <div><b>∞</b><h3>Unseen course</h3><p>The exact course seed stays sealed until launch. Signature moments recur, but their position, approaches, widths, banks and surrounding topology change every race.</p></div>
    </div>
  </div></div>;
}
