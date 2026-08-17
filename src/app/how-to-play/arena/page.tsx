import Link from "next/link";
import PracticeGame from "@/components/practice/PracticeGame";

export const metadata = { title: "How to play ARENA" };

export default function ArenaHowToPlay() {
  return <div className="page"><div className="container how-play-page">
    <Link className="how-play-back" href="/how-it-works">← How Orbs works</Link>
    <span className="eyebrow">ARENA · HOW TO PLAY</span>
    <h1 className="page-title">Move well. Fight for power. <span className="gradient-text">Stay alive.</span></h1>
    <p className="page-intro">Use this tiny local practice floor to learn movement, jumping, and the power button before you enter a live multiplayer Arena.</p>

    <PracticeGame mode="arena" />

    <div className="how-play-device-copy">
      <section><span>DESKTOP</span><h2>Keyboard + Space.</h2><p><strong>Arrow keys or WASD</strong> roll. <strong>Space</strong> jumps normally. When a power is loaded, Space activates it; once Blaster or Super Speed is active, Space goes straight back to Jump.</p></section>
      <section><span>MOBILE</span><h2>Joystick + action.</h2><p>Roll with the <strong>on-screen joystick</strong>. The large action button is <strong>JUMP</strong> normally and becomes your power action when a pickup is loaded.</p></section>
    </div>

    <div className="how-play-rules arena-rules">
      <div><b>↑</b><h3>Double Jump</h3><p>Use the second lift to reach pedestals, clear terrain, or escape an attack.</p></div>
      <div><b>●●●</b><h3>Blaster</h3><p>Activate it and three orange pulses spread gently as they travel. One volley can damage an opponent only once, but the wider spray makes chasing shots much easier to land.</p></div>
      <div><b>◌</b><h3>Cloak</h3><p>Activate Cloak for about 12 seconds. Opponents cannot see your Orb or PFP, while you keep a translucent ghost view of yourself so you can still steer and jump normally.</p></div>
      <div><b>☠</b><h3>Skull Bomb</h3><p>Drop the bomb behind your Orb. It arms after one second, stays visible for about 20 seconds, and deals 75 health plus a strong knockback to the first opponent who rolls over it.</p></div>
      <div><b>»</b><h3>Super Speed</h3><p>Move dramatically faster, become temporarily invulnerable, and hit other Orbs hard.</p></div>
      <div><b>+</b><h3>Health</h3><p>Pink recovery rings restore health immediately. Fight for one when you need a second chance.</p></div>
      <div><b>⚡</b><h3>Column zap</h3><p>The outer columns are live. Hit one and it gives you a small electric hit and pushes you back toward the fight.</p></div>
      <div><b>▲</b><h3>Spikes</h3><p>Some ramp edges are armed with visible spikes. Use the clean center line or jump them.</p></div>
      <div><b>↓</b><h3>Ring out</h3><p>The arches between outer columns are open. Roll off the Arena and your Orb is eliminated, so control your momentum near the edge.</p></div>
      <div><b>∞</b><h3>No match clock</h3><p>A healthy Arena keeps going until one Orb remains. Later power surges keep the fight moving without cutting off a great match.</p></div>
    </div>
  </div></div>;
}
