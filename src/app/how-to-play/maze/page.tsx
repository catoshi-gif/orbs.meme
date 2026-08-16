import Link from "next/link";
import PracticeGame from "@/components/practice/PracticeGame";

export const metadata = { title: "How to play MAZE" };

export default function MazeHowToPlay() {
  return <div className="page"><div className="container how-play-page">
    <Link className="how-play-back" href="/how-it-works">← How Orbs works</Link>
    <span className="eyebrow">MAZE · HOW TO PLAY</span>
    <h1 className="page-title">Roll clean. Clear every ring. <span className="gradient-text">Find the light.</span></h1>
    <p className="page-intro">Practice the exact control idea here before a live Orb. This sandbox is local to your browser—no wallet, Redis, game server, or prize state involved.</p>

    <PracticeGame mode="maze" />

    <div className="how-play-device-copy">
      <section><span>DESKTOP</span><h2>Keyboard steering.</h2><p><strong>Arrow keys or WASD</strong> roll your Orb. In a live MAZE, <strong>Space</strong> toggles the overview and <strong>R</strong> returns you to your latest checkpoint if you get stuck.</p></section>
      <section><span>MOBILE</span><h2>Joystick steering.</h2><p>Use the large <strong>on-screen joystick</strong> to roll. Pinch the live MAZE to zoom. There is no jump in MAZE.</p></section>
    </div>

    <div className="how-play-rules">
      <div><b>01</b><h3>Follow the rings.</h3><p>Cross every glowing checkpoint in order. A ring confirms when you clear it.</p></div>
      <div><b>02</b><h3>Keep your line clean.</h3><p>Momentum matters. Smooth steering is faster than constantly correcting.</p></div>
      <div><b>03</b><h3>Finish only opens last.</h3><p>The goal does not count until every required ring has been cleared.</p></div>
    </div>
  </div></div>;
}
