import Image from "next/image";
import Link from "next/link";
import { listDiscoverableOrbs, orbGameType } from "@/lib/orbStore";
import { getWinners } from "@/lib/upstashWinner";
import { getOrbEntrantCounts } from "@/lib/qualification";
import OrbShowcase from "@/components/OrbShowcase";

export const dynamic = "force-dynamic";

function money(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(value);
}
function amount(value: number) {
  return value.toLocaleString(undefined, { maximumFractionDigits: 6 });
}
function formatLaunch(startsAt: number, now: number) {
  if (startsAt <= now) return "LIVE";
  const minutes = Math.max(1, Math.ceil((startsAt - now) / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.ceil(minutes / 60);
  return `${hours}h`;
}
function difficultyLabel(value: string) {
  return value === "quick" ? "Easy · ~2 min" : value === "classic" ? "Medium · ~4 min" : "Hard · ~6 min";
}

export default async function Home() {
  const now = Date.now();
  const discovered = await listDiscoverableOrbs(9);
  const winners = await getWinners(discovered.map((orb) => orb.id));
  const entrants = await getOrbEntrantCounts(discovered.map((orb) => orb.slug));
  // Homepage discovery is intentionally pre-launch only. Once an Orb reaches its
  // scheduled launch time it leaves this feed, regardless of its later competition
  // window/result state. Live/failed games remain reachable by their direct URL and
  // dashboards, but are never advertised as a fresh game people can still prepare for.
  const orbs = discovered.filter((orb) => !winners.has(orb.id) && orb.startsAt > now).slice(0, 6);
  const next = orbs[0];

  return <>
    <section className="hero hero-game-backdrop"><OrbShowcase background className="home-orb-showcase"/><div className="hero-grid"><div><div className="eyebrow">MAZE · ARENA · RACE · LIVE ON SOLANA</div><h1 className="home-hero-title"><span className="home-hero-line">Where communities</span><span className="home-hero-line gradient-text">play for their tokens.</span></h1><p>Host a game, put up a token prize, and bring your community, or jump into a live Orb and play for someone else&apos;s.</p><div className="hero-actions"><a className="btn-primary" href="#live">Find an upcoming Orb</a><Link className="btn-secondary" href="/create">Create an Orb</Link></div><div className="trust"><span>Free to enter</span><span>Skill decides</span><span>Prize escrowed before launch</span></div></div><div className="visual"><Image src="/orbs-logo-512.png" width={512} height={512} alt="" priority/><div className="visual-card"><span className="eyebrow">{next ? "Starting soon" : "Next Orb"}</span><strong>{next ? formatLaunch(next.startsAt, now) : "—"}</strong><small>{orbs.length ? "MAZE, ARENA and RACE. One link, one launch, one winner." : "No upcoming public Orbs right now."}</small></div></div></div></section>


    <section className="section section-soft" id="live"><div className="container"><div className="section-head"><div><span className="eyebrow">Coming up</span><h2>Upcoming Orbs.</h2></div><p>Pick your game, register before launch, and come back ready to play.</p></div>
      {orbs.length ? <div className="cards3 live-orb-grid">{orbs.map((orb) => {
        const qualified = entrants.get(orb.slug) || 0;
        return <Link className="orb-card live-orb-card" href={`/orb/${orb.slug}`} key={orb.id}>
          <div className="orb-top"><div className="hostline">{orb.hostX.profileImageUrl ? <img className="host-avatar" src={orb.hostX.profileImageUrl} alt="" referrerPolicy="no-referrer"/> : <span className="avatar"/>}<span>@{orb.hostX.username}</span><span className="game-type-chip">{orbGameType(orb).toUpperCase()}</span></div><span className="pill">{`Starts in ${formatLaunch(orb.startsAt, now)}`}</span></div>
          <div className="live-prize-row">
            <div className="live-token-logo">{orb.token.logoURI ? <img src={orb.token.logoURI} alt="" referrerPolicy="no-referrer" loading="lazy"/> : <span>{orb.token.symbol.slice(0, 2).toUpperCase()}</span>}</div>
            <div className="live-prize-copy"><div className="prize">{amount(orb.prizeTokenAmount)} {orb.token.symbol}</div><div className="muted">≈ {money(orb.prizeUsd)} winner prize</div></div>
          </div>
          <div className="orb-meta"><span>{orbGameType(orb) === "maze" ? difficultyLabel(orb.difficulty) : "Live multiplayer"}</span><span>{qualified ? `${qualified} ${qualified === 1 ? "player" : "players"} ready` : "Open for entries"}</span></div>
          <div className="live-orb-cta"><span>View Orb & sign up</span><strong aria-hidden="true">→</strong></div>
        </Link>;
      })}</div> : <div className="card live-feed-empty"><span className="eyebrow">Quiet orbit</span><h3>No upcoming games at the moment.</h3><p>The next funded Orb will appear here automatically as soon as its escrow is confirmed.</p><Link className="btn-primary" href="/create">Create the next Orb</Link></div>}
      <div className="live-feed-footer"><Link className="btn-secondary" href="/leaderboard">View winner leaderboard →</Link></div>
    </div></section>

    <section className="section"><div className="container"><div className="section-head"><div><span className="eyebrow">Drop an Orb</span><h2>Give everyone something to show up for.</h2></div><p>A token prize gives the community something to rally around. The countdown builds anticipation. Then everyone shows up to play.</p></div><div className="steps3"><div className="card"><div className="step">1</div><h3>Pick the game</h3><p>Choose MAZE for a race against the course, ARENA for last-Orb-standing combat, or RACE for live three-lap multiplayer.</p></div><div className="card"><div className="step">2</div><h3>Put up the prize</h3><p>Choose SOL or a supported token your community already cares about. The winner prize is escrowed before launch.</p></div><div className="card"><div className="step">3</div><h3>Set the time</h3><p>Share one link. Everyone meets in the same waiting room, launches together, and plays for one verified winner.</p></div></div></div></section>
    <section className="section community-section"><div className="container"><div className="community-card"><div><span className="eyebrow">Join the orbit</span><h2>Follow the chaos.</h2><p>Catch new Orbs, winner moments, and community updates on X and Discord.</p></div><div className="community-actions"><a className="btn-secondary community-social" href="https://x.com/orbsdotmeme" target="_blank" rel="noopener noreferrer"><Image src="/social-x.png" width={22} height={22} alt=""/>Follow on X</a><a className="btn-secondary community-social" href="https://discord.gg/32yWCvqnh" target="_blank" rel="noopener noreferrer"><Image src="/social-discord.png" width={22} height={22} alt=""/>Join Discord</a></div></div></div></section>
    <section className="section open-source-section"><div className="container"><div className="open-source-card"><div className="open-source-copy"><span className="eyebrow">Open source · MIT</span><h2>See how Orbs works.</h2><p>The full codebase—from the Solana program and deterministic verification to the realtime ARENA and RACE authorities—is open for anyone to inspect, fork, and build on.</p></div><a className="btn-secondary open-source-link" href="https://github.com/catoshi-gif/orbs.meme" target="_blank" rel="noopener noreferrer" aria-label="View the Orbs.meme source code on GitHub"><svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 .7a11.3 11.3 0 0 0-3.57 22.02c.57.1.78-.25.78-.55v-2.16c-3.18.69-3.85-1.35-3.85-1.35-.52-1.32-1.27-1.67-1.27-1.67-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.02 1.75 2.68 1.25 3.33.95.1-.74.4-1.25.73-1.54-2.54-.29-5.21-1.27-5.21-5.59 0-1.24.44-2.25 1.18-3.04-.12-.29-.51-1.46.11-3 0 0 .96-.31 3.11 1.16A10.8 10.8 0 0 1 12 6.03c.96 0 1.92.13 2.83.38 2.15-1.47 3.11-1.16 3.11-1.16.62 1.54.23 2.71.11 3 .74.79 1.18 1.8 1.18 3.04 0 4.33-2.68 5.29-5.23 5.58.41.36.78 1.06.78 2.14v3.16c0 .3.21.66.79.55A11.3 11.3 0 0 0 12 .7Z"/></svg><span>View source on GitHub</span><strong aria-hidden="true">↗</strong></a></div></div></section>
    <section className="section"><div className="container"><div className="cta"><h2>Give your community something to show up for.</h2><p>Pick MAZE, ARENA or RACE, put up the prize, and drop the link.</p><Link className="btn-primary" href="/create">Create your first Orb</Link></div></div></section>
  </>;
}
