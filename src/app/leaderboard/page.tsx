import Link from "next/link";
import { getWinnerLeaderboard } from "@/lib/upstashWinner";

export const dynamic = "force-dynamic";
export const metadata = { title: "Winner leaderboard" };

export default async function LeaderboardPage() {
  const leaders = await getWinnerLeaderboard(10);
  return <div className="page"><div className="container leaderboard-page">
    <span className="eyebrow">All-time winners</span>
    <h1 className="page-title">Winners leave receipts.</h1>
    <p className="page-intro">Top X accounts by verified MAZE, ARENA and RACE wins. Wallet addresses stay out of the public leaderboard.</p>
    {leaders.length ? <div className="leaderboard-card">
      <div className="leaderboard-head"><span>Rank</span><span>Player</span><span>Wins</span></div>
      {leaders.map((leader) => <a className="leaderboard-row" href={`https://x.com/${encodeURIComponent(leader.xUsername)}`} target="_blank" rel="noreferrer" key={leader.xUserId}>
        <strong className="leaderboard-rank">#{leader.rank}</strong><div><strong>@{leader.xUsername}</strong><small>view on X ↗</small></div><strong className="leaderboard-wins">{leader.wins}</strong>
      </a>)}
    </div> : <div className="card leaderboard-empty"><h3>No leaderboard wins yet.</h3><p>The first verified winner on the new leaderboard index gets the #1 spot.</p><Link className="btn-primary" href="/#live">Find an Orb</Link></div>}
    <p className="leaderboard-note">Only verified game wins count. No wallet address is needed to rank publicly.</p>
  </div></div>;
}
