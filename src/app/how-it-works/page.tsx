import Link from "next/link";

export const metadata = { title: "How it works" };

const protocolSteps = [
  ["1", "Create", "Connect X and Solana, choose a supported token, set the full commitment, configure the game and schedule launch."],
  ["2", "Share", "Orbs creates a unique public waiting room with the prize, countdown and registration flow so your post can build momentum."],
  ["3", "Race", "At the committed time, every registered player receives the same hidden-until-launch game. Skill determines the first valid finish."],
  ["4", "Claim", "The winning wallet receives a secure claim flow. The final payout comes from the isolated on-chain Orb vault."],
  ["5", "Keep playing", "After a winner exists, everyone else can continue the maze for fun instead of being kicked out."],
  ["6", "Drop another Orb", "Players become future hosts, winners can share their result, and the next funded game starts the loop again."],
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

export default function Page() {
  return (
    <div className="page">
      <div className="container">
        <span className="eyebrow">Simple by design</span>
        <h1 className="page-title">One prize. One link. <span className="gradient-text">One live race.</span></h1>
        <p className="page-intro">Orbs turns a funded token reward into a timed social event your community can actually participate in.</p>

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
            <span className="eyebrow">Gameplay guide</span>
            <h2>Know the maze before the clock starts.</h2>
            <p>Registration happens in the waiting room. The maze stays sealed until launch. Once it opens, the race is simple: roll, clear every glowing ring in order, then reach the finish before everyone else.</p>
          </div>

          <div className="gameplay-preflight">
            <div className="gameplay-preflight-copy">
              <span className="gameplay-mini-label">Before you play</span>
              <h3>Finish all 6 registration steps.</h3>
              <p>You can watch the waiting room without registering, but Orbs will not issue a competitive game session until all six checks are complete.</p>
            </div>
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
                <p>The waiting room shows a live countdown and your local start time. When the Orb opens, enter the live maze and press <b>Start run</b>. The 3…2…1 countdown begins your attempt.</p>
              </div>
            </div>
          </div>

          <div className="gameplay-control-grid">
            <article className="gameplay-control-card">
              <div className="gameplay-device-heading">
                <span className="gameplay-device-icon" aria-hidden="true">⌨</span>
                <div><span>Desktop</span><h3>Precision controls.</h3></div>
              </div>
              <div className="gameplay-control-list">
                <div><kbd>↑</kbd><kbd>↓</kbd><kbd>←</kbd><kbd>→</kbd><p><strong>Roll the marble.</strong><br/>Arrow keys steer directly. WASD works too.</p></div>
                <div><kbd className="wide">SPACE</kbd><p><strong>Toggle the full-board overview.</strong><br/>Press Space to zoom all the way out, then press it again to return to chase view. You can keep steering while zoomed out.</p></div>
                <div><kbd>R</kbd><p><strong>Recover.</strong><br/>Return to the latest checkpoint if you get stuck.</p></div>
              </div>
            </article>

            <article className="gameplay-control-card mobile">
              <div className="gameplay-device-heading">
                <span className="gameplay-device-icon phone" aria-hidden="true">▯</span>
                <div><span>Mobile</span><h3>Tilt or touch.</h3></div>
              </div>
              <div className="gameplay-control-list">
                <div><span className="control-pictogram">↗</span><p><strong>Tilt your phone to roll.</strong><br/>Enable motion controls, hold your phone naturally and steer by tilting the device.</p></div>
                <div><span className="control-pictogram">●</span><p><strong>Prefer touch?</strong><br/>Switch to the on-screen joystick at any time. It controls the same marble physics.</p></div>
                <div><span className="control-pictogram">⇱</span><p><strong>Pinch to zoom.</strong><br/>Pinch inward to reveal the entire board. Spread back out to return to chase view. Steering stays live while you zoom.</p></div>
              </div>
            </article>
          </div>

          <div className="gameplay-rings-card">
            <div className="gameplay-rings-copy">
              <span className="gameplay-mini-label">The one rule that matters</span>
              <h3>Cross every glowing ring. In order.</h3>
              <p>The finish does not open until every checkpoint has been cleared. Each ring gives you an audible chime and the marble grows brighter as you progress. Miss one and you still have work to do.</p>
            </div>
            <div className="gameplay-ring-track" aria-hidden="true">
              <span className="ring done" />
              <i />
              <span className="ring active" />
              <i />
              <span className="ring" />
              <i />
              <span className="goal-dot">✦</span>
            </div>
          </div>

          <div className="gameplay-difficulty-section">
            <div className="gameplay-difficulty-heading">
              <div>
                <span className="gameplay-mini-label">Choose your race</span>
                <h3>Three difficulty bands.</h3>
              </div>
              <p>Completion times are targets, not guarantees. Every funded Orb gets its own deterministic maze.</p>
            </div>
            <div className="gameplay-difficulty-grid">
              {difficulties.map((difficulty, index) => (
                <div className={`gameplay-difficulty-card d${index + 1}`} key={difficulty.name}>
                  <span>{difficulty.level}</span>
                  <h4>{difficulty.name}</h4>
                  <strong>{difficulty.time}</strong>
                  <p>target completion</p>
                  <div><b>{difficulty.checkpoints}</b><small>clear before finish</small></div>
                </div>
              ))}
            </div>
          </div>

          <div className="gameplay-finish-strip">
            <div><span>01</span><p><strong>Register first.</strong><br/>All six checks must be green.</p></div>
            <div><span>02</span><p><strong>Enter at launch.</strong><br/>Press Start run when the live maze opens.</p></div>
            <div><span>03</span><p><strong>Clear every ring.</strong><br/>Checkpoint order is enforced.</p></div>
            <div><span>04</span><p><strong>Find the light.</strong><br/>The first server-verified finish wins the prize.</p></div>
          </div>
        </section>

        <div className="how-create-cta">
          <div><span className="eyebrow">Ready?</span><h2>Drop an Orb.</h2><p>Fund the prize, set the launch, and let your community race.</p></div>
          <Link className="btn-primary" href="/create">Create an Orb →</Link>
        </div>
      </div>
    </div>
  );
}
