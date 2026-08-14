import Image from "next/image";
import Link from "next/link";
import { listDiscoverableOrbs } from "@/lib/orbStore";
import { getWinners } from "@/lib/upstashWinner";
import { getOrbEntrantCounts } from "@/lib/qualification";

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
  const orbs = discovered.filter((orb) => !winners.has(orb.id) && now < orb.endsAt).slice(0, 6);
  const next = orbs.find((orb) => orb.startsAt > now);

  return <>
    <section className="hero"><div className="hero-grid"><div><div className="eyebrow">The gamified viral marketing protocol</div><h1>Put up a reward. <span className="gradient-text">Drop an Orb.</span> Grow your community.</h1><p>Create a live glass-marble challenge for your followers. Fund the prize with a Solana token. First valid finish wins.</p><div className="hero-actions"><Link className="btn-primary" href="/create">Create an Orb</Link><a className="btn-secondary" href="#live">Find a live Orb</a></div><div className="trust"><span>Free to play</span><span>Skill decides</span><span>Prize escrowed before launch</span></div></div><div className="visual"><Image src="/orbs-logo-512.png" width={512} height={512} alt="" priority/><div className="visual-card"><span className="eyebrow">{next ? "Starting soon" : orbs.some((orb) => orb.startsAt <= now) ? "Race live" : "Next Orb"}</span><strong>{next ? formatLaunch(next.startsAt, now) : orbs.some((orb) => orb.startsAt <= now) ? "LIVE" : "—"}</strong><small>{orbs.length ? "One link. One maze. First valid finish wins." : "No funded public Orbs are waiting right now."}</small></div></div></div></section>

    <section className="section section-soft" id="live"><div className="container"><div className="section-head"><div><span className="eyebrow">Live network</span><h2>Funded Orbs happening for real.</h2></div><p>This feed is generated from funded Orbs in the live store. No demo hosts, fake prizes, or placeholder races.</p></div>
      {orbs.length ? <div className="cards3 live-orb-grid">{orbs.map((orb) => {
        const live = orb.startsAt <= now;
        const qualified = entrants.get(orb.slug) || 0;
        return <Link className="orb-card" href={`/orb/${orb.slug}`} key={orb.id}>
          <div className="orb-top"><div className="hostline">{orb.hostX.profileImageUrl ? <img className="host-avatar" src={orb.hostX.profileImageUrl} alt="" referrerPolicy="no-referrer"/> : <span className="avatar"/>}<span>@{orb.hostX.username}</span></div><span className={`pill ${live ? "live" : ""}`}>{formatLaunch(orb.startsAt, now)}</span></div>
          <div className="prize">{amount(orb.prizeTokenAmount)} {orb.token.symbol}</div><div className="muted">≈ {money(orb.prizeUsd)} winner prize</div><div className="orb-meta"><span>{difficultyLabel(orb.difficulty)}</span><span>{qualified ? `${qualified} qualified` : "Open for entries"}</span></div>
        </Link>;
      })}</div> : <div className="card live-feed-empty"><span className="eyebrow">Quiet orbit</span><h3>No upcoming games at the moment.</h3><p>The next funded Orb will appear here automatically as soon as its escrow is confirmed.</p><Link className="btn-primary" href="/create">Create the next Orb</Link></div>}
      <div className="live-feed-footer"><Link className="btn-secondary" href="/leaderboard">View winner leaderboard →</Link></div>
    </div></section>

    <section className="section"><div className="container"><div className="section-head"><div><span className="eyebrow">The loop</span><h2>Play. Win. Grow.</h2></div><p>The prize buys attention, the game turns attention into an event, and every player becomes a potential future host.</p></div><div className="steps3"><div className="card"><div className="step">1</div><h3>Fund an Orb</h3><p>Choose SOL or a supported standard SPL token, set your total commitment, pick a 2 / 4 / 6 minute format, customize the look, and schedule launch.</p></div><div className="card"><div className="step">2</div><h3>Share the countdown</h3><p>Your unique Orb URL becomes the social event. Players qualify, the post has time to spread, and everyone waits for the same launch.</p></div><div className="card"><div className="step">3</div><h3>First valid finish wins</h3><p>When the timer hits zero, the committed game appears. The authoritative game service validates the race and the winner claims the prize.</p></div></div></div></section>
    <section className="section"><div className="container"><div className="cta"><h2>Every Orb is a game your community can rally around.</h2><p>Start small. Make it beautiful. Give somebody a real reason to show up.</p><Link className="btn-primary" href="/create">Create your first Orb</Link></div></div></section>
  </>;
}
