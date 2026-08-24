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
    <section className="hero hero-game-backdrop"><OrbShowcase background className="home-orb-showcase"/><div className="hero-grid"><div><div className="eyebrow">MAZE · ARENA · LIVE ON SOLANA</div><h1>Where communities <span className="gradient-text">play for their tokens.</span></h1><p>Host a game, put up a token prize, and bring your community, or jump into a live Orb and play for someone else&apos;s.</p><div className="hero-actions"><a className="btn-primary" href="#live">Find an upcoming Orb</a><Link className="btn-secondary" href="/create">Create an Orb</Link></div><div className="trust"><span>Free to enter</span><span>Skill decides</span><span>Prize escrowed before launch</span></div></div><div className="visual"><Image src="/orbs-logo-512.png" width={512} height={512} alt="" priority/><div className="visual-card"><span className="eyebrow">{next ? "Starting soon" : "Next Orb"}</span><strong>{next ? formatLaunch(next.startsAt, now) : "—"}</strong><small>{orbs.length ? "MAZE and ARENA. One link, one launch, one winner." : "No upcoming public Orbs right now."}</small></div></div></div></section>


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

    <section className="section"><div className="container"><div className="section-head"><div><span className="eyebrow">Drop an Orb</span><h2>Give everyone something to show up for.</h2></div><p>A token prize gives the community something to rally around. The countdown builds anticipation. Then everyone shows up to play.</p></div><div className="steps3"><div className="card"><div className="step">1</div><h3>Pick the game</h3><p>Choose MAZE for a race against the course or ARENA for live multiplayer.</p></div><div className="card"><div className="step">2</div><h3>Put up the prize</h3><p>Choose SOL or a supported token your community already cares about. The winner prize is escrowed before launch.</p></div><div className="card"><div className="step">3</div><h3>Set the time</h3><p>Share one link. Everyone meets in the same waiting room, launches together, and plays for one verified winner.</p></div></div></div></section>
    <section className="section community-section"><div className="container"><div className="community-card"><div><span className="eyebrow">Join the orbit</span><h2>Follow the chaos.</h2><p>Catch new Orbs, winner moments, and community updates on X and Discord.</p></div><div className="community-actions"><a className="btn-secondary community-social" href="https://x.com/orbsdotmeme" target="_blank" rel="noopener noreferrer"><Image src="/social-x.png" width={22} height={22} alt=""/>Follow on X</a><a className="btn-secondary community-social" href="https://discord.gg/32yWCvqnh" target="_blank" rel="noopener noreferrer"><Image src="/social-discord.png" width={22} height={22} alt=""/>Join Discord</a></div></div></div></section>
    <section className="section"><div className="container"><div className="cta"><h2>Give your community something to show up for.</h2><p>Pick MAZE or ARENA, put up the prize, and drop the link.</p><Link className="btn-primary" href="/create">Create your first Orb</Link></div></div></section>
  </>;
}
