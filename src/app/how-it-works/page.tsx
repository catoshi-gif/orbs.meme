import Link from "next/link";

export const metadata = { title: "How it works" };

const protocolSteps = [
  ["1", "Create", "Connect X and Solana, choose MAZE or ARENA, put up the prize, customize the world, and set the launch."],
  ["2", "Share", "Orbs gives you one public waiting-room link with the prize, countdown, host identity, and registration flow."],
  ["3", "Register", "Players complete the required X, wallet, eligibility, human, and entry-post checks before competitive play."],
  ["4", "Launch", "Everyone returns for the same scheduled start. MAZE reveals its sealed course; ARENA synchronizes one live multiplayer match."],
  ["5", "Play", "Skill decides the result under the rules of the selected game. Orbs verifies the winning result server-side."],
  ["6", "Claim", "The verified winning wallet claims the prize from the Orb's isolated on-chain vault."],
];

const registrationSteps = [
  "Connect X",
  "Follow the host",
  "Verify your wallet",
  "Confirm 18+ eligibility",
  "Pass the human check",
  "Share + verify your entry post",
];

const difficulties = [
  { name: "Quick", level: "Easy", time: "~2 min", checkpoints: "3 rings" },
  { name: "Classic", level: "Medium", time: "~4 min", checkpoints: "4 rings" },
  { name: "Brutal", level: "Hard", time: "~6 min", checkpoints: "5 rings" },
];

const arenaPowers = [
  ["DOUBLE JUMP", "Grab the gold ↑ ring or a charged pedestal to load a second jump. Use it to reach high ground, clear terrain, or escape an attack."],
  ["BLASTER", "Grab the orange ring, activate it, and fire forward for a short window while you keep moving and jumping."],
  ["SUPER SPEED", "Grab the cyan ring for a short burst of extreme speed and invulnerability. Your powered Orb can still damage opponents."],
  ["HEALTH", "Pink recovery rings restore health immediately. A damaged player can fight for one and earn a second chance."],
];

export default function Page() {
  return (
    <div className="page">
      <div className="container">
        <span className="eyebrow">How Orbs works</span>
        <h1 className="page-title">One prize. One link. <span className="gradient-text">MAZE or ARENA.</span></h1>
        <p className="page-intro">Orbs is where online communities play for their tokens. Hosts put up the prize. Players enter free. The game decides the winner.</p>

        <div className="steps3 how-protocol-steps">
          {protocolSteps.map(([n, title, body]) => (
            <div className="card" key={n}>
              <div className="step">{n}</div>
              <h3>{title}</h3>
              <p>{body}</p>
            </div>
          ))}
        </div>

        <section className="gameplay-guide">
          <div className="gameplay-guide-heading">
            <span className="eyebrow">Choose your game</span>
            <h2>Two games. Two kinds of skill.</h2>
            <p>Every Orb shares the same funded-prize, registration, launch, verification, and claim flow. What happens after launch depends on the game.</p>
          </div>
          <div className="steps3">
            <div className="card">
              <span className="game-type-chip">MAZE</span>
              <h3>Race the course.</h3>
              <p>Everyone gets the same sealed deterministic challenge. Clear every checkpoint in order and be the first server-verified finisher.</p>
            </div>
            <div className="card">
              <span className="game-type-chip">ARENA</span>
              <h3>Fight the field.</h3>
              <p>Everyone enters one live authoritative match. Use movement, terrain, jumps, powers, and positioning to outplay the other Orbs.</p>
            </div>
            <div className="card">
              <span className="game-type-chip">BOTH</span>
              <h3>Free to enter.</h3>
              <p>The host funds the prize before launch. Players do not stake tokens against one another. One verified winner can claim the prize.</p>
            </div>
          </div>
        </section>

        <section className="gameplay-guide">
          <div className="gameplay-guide-heading">
            <span className="eyebrow">Before either game</span>
            <h2>Get registered before launch.</h2>
            <p>You can watch a waiting room without registering, but Orbs will not issue a competitive game session until all required checks are complete.</p>
          </div>
          <div className="gameplay-preflight">
            <div className="gameplay-registration-grid">
              {registrationSteps.map((step, index) => (
                <div className="gameplay-registration-item" key={step}>
                  <span>{index + 1}</span>
                  <strong>{step}</strong>
                </div>
              ))}
            </div>
            <div className="gameplay-launch-note">
              <span className="gameplay-launch-orb" aria-hidden="true" />
              <div>
                <strong>Be back before launch.</strong>
                <p>The waiting room shows the countdown and your local start time. ARENA opens a short synchronization window before launch so registered players can connect to the same live match.</p>
              </div>
            </div>
          </div>
        </section>

        <section className="gameplay-guide">
          <div className="gameplay-guide-heading">
            <span className="eyebrow">MAZE</span>
            <h2>Clear the rings. Find the light.</h2>
            <p>The course stays sealed until launch. Once it opens, roll through every glowing checkpoint in order and reach the finish before everyone else.</p>
          </div>

          <div className="gameplay-control-grid">
            <article className="gameplay-control-card">
              <div className="gameplay-device-heading">
                <span className="gameplay-device-icon" aria-hidden="true">⌨</span>
                <div><span>Desktop</span><h3>Precision controls.</h3></div>
              </div>
              <div className="gameplay-control-list">
                <div><kbd>↑</kbd><kbd>↓</kbd><kbd>←</kbd><kbd>→</kbd><p><strong>Roll your Orb.</strong><br/>Arrow keys steer directly. WASD works too.</p></div>
                <div><kbd className="wide">SPACE</kbd><p><strong>Toggle the full-board overview.</strong><br/>Press Space to zoom out, then again to return to chase view. Steering stays live.</p></div>
                <div><kbd>R</kbd><p><strong>Recover.</strong><br/>Return to the latest checkpoint if you get stuck.</p></div>
              </div>
            </article>

            <article className="gameplay-control-card mobile">
              <div className="gameplay-device-heading">
                <span className="gameplay-device-icon phone" aria-hidden="true">▯</span>
                <div><span>Mobile</span><h3>Joystick control.</h3></div>
              </div>
              <div className="gameplay-control-list">
                <div><span className="control-pictogram">●</span><p><strong>Steer with the joystick.</strong><br/>The on-screen joystick is always available during mobile play.</p></div>
                <div><span className="control-pictogram">⇱</span><p><strong>Pinch to zoom.</strong><br/>Reveal the full board without giving up steering.</p></div>
              </div>
            </article>
          </div>

          <div className="gameplay-rings-card">
            <div className="gameplay-rings-copy">
              <span className="gameplay-mini-label">The rule that matters</span>
              <h3>Cross every glowing ring. In order.</h3>
              <p>The finish stays closed until every checkpoint is cleared. Each ring chimes and your Orb grows brighter as you progress.</p>
            </div>
            <div className="gameplay-ring-track" aria-hidden="true">
              <span className="ring done" /><i/><span className="ring active" /><i/><span className="ring" /><i/><span className="goal-dot">✦</span>
            </div>
          </div>

          <div className="gameplay-difficulty-section">
            <div className="gameplay-difficulty-heading">
              <div><span className="gameplay-mini-label">MAZE difficulty</span><h3>Three challenge bands.</h3></div>
              <p>Completion times are targets, not guarantees. Every funded MAZE gets its own deterministic course.</p>
            </div>
            <div className="gameplay-difficulty-grid">
              {difficulties.map((difficulty, index) => (
                <div className={`gameplay-difficulty-card d${index + 1}`} key={difficulty.name}>
                  <span>{difficulty.level}</span><h4>{difficulty.name}</h4><strong>{difficulty.time}</strong><p>target completion</p><div><b>{difficulty.checkpoints}</b><small>clear before finish</small></div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="gameplay-guide">
          <div className="gameplay-guide-heading">
            <span className="eyebrow">ARENA</span>
            <h2>Move well. Fight for power. Stay alive.</h2>
            <p>ARENA is one synchronized multiplayer match. The server owns the physics and result; your browser sends controls and renders the authoritative world.</p>
          </div>

          <div className="gameplay-control-grid">
            <article className="gameplay-control-card">
              <div className="gameplay-device-heading">
                <span className="gameplay-device-icon" aria-hidden="true">⌨</span>
                <div><span>Desktop</span><h3>Move + jump.</h3></div>
              </div>
              <div className="gameplay-control-list">
                <div><kbd>↑</kbd><kbd>↓</kbd><kbd>←</kbd><kbd>→</kbd><p><strong>Roll your Orb.</strong><br/>Arrow keys or WASD steer relative to your camera.</p></div>
                <div><kbd className="wide">SPACE</kbd><p><strong>Jump or use a loaded power.</strong><br/>Activate Blaster or Super Speed, then keep jumping while the power runs.</p></div>
                <div><span className="control-pictogram">◎</span><p><strong>Watch your health.</strong><br/>Hard hits and weapons hurt. Reach zero and your Orb is eliminated.</p></div>
              </div>
            </article>

            <article className="gameplay-control-card mobile">
              <div className="gameplay-device-heading">
                <span className="gameplay-device-icon phone" aria-hidden="true">▯</span>
                <div><span>Mobile</span><h3>Same game, touch controls.</h3></div>
              </div>
              <div className="gameplay-control-list">
                <div><span className="control-pictogram">●</span><p><strong>Steer with the joystick.</strong><br/>Movement uses the same Arena physics as desktop.</p></div>
                <div><span className="control-pictogram">↑</span><p><strong>Use the action button.</strong><br/>Jump normally or activate the power you picked up.</p></div>
                <div><span className="control-pictogram">◉</span><p><strong>Your PFP marks your Orb.</strong><br/>Colors and glow make each player easy to distinguish.</p></div>
              </div>
            </article>
          </div>

          <div className="steps3">
            {arenaPowers.map(([name, body]) => (
              <div className="card" key={name}><span className="gameplay-mini-label">Power</span><h3>{name}</h3><p>{body}</p></div>
            ))}
          </div>

          <div className="gameplay-finish-strip">
            <div><span>01</span><p><strong>Connect early.</strong><br/>Use the pre-launch synchronization window.</p></div>
            <div><span>02</span><p><strong>Use the terrain.</strong><br/>Ramps, stairs, pedestals, and elevation create attack routes.</p></div>
            <div><span>03</span><p><strong>Fight for powers.</strong><br/>Pickups create short windows to attack, escape, or recover.</p></div>
            <div><span>04</span><p><strong>Stay in the match.</strong><br/>The authoritative Arena server verifies the winner.</p></div>
          </div>
        </section>

        <div className="how-create-cta">
          <div><span className="eyebrow">Ready?</span><h2>Drop an Orb.</h2><p>Choose MAZE or ARENA, put up the prize, set the launch, and bring your community.</p></div>
          <Link className="btn-primary" href="/create">Create an Orb →</Link>
        </div>
      </div>
    </div>
  );
}
