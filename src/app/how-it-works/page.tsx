import Link from "next/link";

export const metadata = { title: "How it works" };

const protocolSteps = [
  ["1", "Create", "Connect X and Solana, choose MAZE, ARENA or RACE, put up the prize, customize the world, and set the launch."],
  ["2", "Share", "Orbs gives you one public waiting-room link with the prize, countdown, host identity, and registration flow."],
  ["3", "Register", "Players complete the required X, wallet, eligibility, human, and entry-post checks before competitive play."],
  ["4", "Launch", "Keep the waiting room open. Registered players enter automatically: MAZE opens at the launch clock, while ARENA and RACE quietly prepare their authoritative live connections just before launch."],
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

export default function Page() {
  return (
    <div className="page">
      <div className="container">
        <span className="eyebrow">How Orbs works</span>
        <h1 className="page-title">One prize. One link. <span className="gradient-text">MAZE, ARENA or RACE.</span></h1>
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
            <span className="eyebrow">Learn before launch</span>
            <h2>Three games. Three practice floors.</h2>
            <p>Open the guide on the device you plan to play with. Each guide presents the right control model and a safe practice experience before you enter a prize-bearing live game.</p>
          </div>
          <div className="how-game-links">
            <Link className="how-game-link maze" href="/how-to-play/maze">
              <span className="game-type-chip">MAZE</span>
              <div><h3>Race the course.</h3><p>Learn keyboard or joystick movement, then practice clearing glowing rings in order.</p></div>
              <strong>Practice MAZE →</strong>
            </Link>
            <Link className="how-game-link arena" href="/how-to-play/arena">
              <span className="game-type-chip">ARENA</span>
              <div><h3>Fight the field.</h3><p>Learn movement, Jump, and how the same action control activates a loaded power.</p></div>
              <strong>Practice ARENA →</strong>
            </Link>
            <Link className="how-game-link race" href="/how-to-play/race">
              <span className="game-type-chip">RACE</span>
              <div><h3>Own the Prismway.</h3><p>Practice gas, steering, Jump + item use, then learn three laps, grid priority, Perfect Start, weapons, Turbo and Nimbus rescue.</p></div>
              <strong>Practice RACE →</strong>
            </Link>
          </div>
        </section>

        <section className="gameplay-guide">
          <div className="gameplay-guide-heading">
            <span className="eyebrow">Before every game</span>
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
                <p>The waiting room shows the countdown and your local start time. Keep it open: registered MAZE players enter automatically, while registered ARENA and RACE players are prepared automatically in the final minute so everyone reaches the same authoritative live match.</p>
              </div>
            </div>
          </div>
        </section>

        <section className="gameplay-guide how-trust-guide">
          <div className="gameplay-guide-heading">
            <span className="eyebrow">Same prize discipline</span>
            <h2>The game changes. The trust model does not.</h2>
            <p>The host funds the prize before launch. Players do not stake tokens against one another. MAZE verifies the first legitimate finish; ARENA and RACE use their isolated authoritative multiplayer servers to determine the legitimate winner.</p>
          </div>
          <div className="steps3">
            <div className="card"><span className="gameplay-mini-label">Funded</span><h3>Prize first.</h3><p>The prize is committed before competitive play begins.</p></div>
            <div className="card"><span className="gameplay-mini-label">Free entry</span><h3>Players do not wager.</h3><p>Complete registration, show up, and play. The host supplied the prize.</p></div>
            <div className="card"><span className="gameplay-mini-label">Verified</span><h3>One legitimate winner.</h3><p>The winning result is verified server-side before the prize can be claimed.</p></div>
          </div>
        </section>

        <div className="how-create-cta">
          <div><span className="eyebrow">Ready?</span><h2>Drop an Orb.</h2><p>Choose MAZE, ARENA or RACE, put up the prize, set the launch, and bring your community.</p></div>
          <Link className="btn-primary" href="/create">Create an Orb →</Link>
        </div>
      </div>
    </div>
  );
}
