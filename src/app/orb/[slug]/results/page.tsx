import Image from "next/image";
import Link from "next/link";
import ClaimPrizeButton from "@/components/ClaimPrizeButton";
import RefundPrizeButton from "@/components/RefundPrizeButton";
import WinnerShareCard from "@/components/WinnerShareCard";
import { getPublicOrb, orbGameType } from "@/lib/orbStore";
import { getWinner } from "@/lib/upstashWinner";

export const dynamic = "force-dynamic";

function formatTime(ms?: number) {
  if (!ms || !Number.isFinite(ms)) return "—";
  const seconds = ms / 1000;
  const min = Math.floor(seconds / 60);
  const sec = Math.floor(seconds % 60);
  const millis = Math.floor(ms % 1000);
  return `${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
}
function amount(value: number) { return value.toLocaleString(undefined, { maximumFractionDigits: 6 }); }

export default async function Page({params}:{params:Promise<{slug:string}>}) {
  const {slug}=await params;
  const orb = await getPublicOrb(slug);
  const winner = orb ? await getWinner(orb.id) : await getWinner(slug);
  const gameType = orb ? orbGameType(orb) : "maze";
  const expired = Boolean(orb && Date.now() >= orb.endsAt);
  const prize = orb ? `${amount(orb.prizeTokenAmount)} ${orb.token.symbol}` : "Prize";
  const claimed = Boolean(winner?.claimTxSignature);
  const winnerIdentity = winner?.xUsername
    ? <><strong>@{winner.xUsername}</strong> · </>
    : winner?.wallet
      ? <><code>{winner.wallet.slice(0,3)}…</code> · </>
      : null;

  const eyebrow = claimed ? "Prize claimed" : winner ? `${gameType.toUpperCase()} winner verified` : expired ? "Orb expired" : "Orb result";
  const headline = claimed
    ? (gameType === "arena" ? "The Arena has its winner." : gameType === "race" ? "The Race has its winner." : "The prize found its winner.")
    : winner
      ? (gameType === "arena" ? "The Arena has a winner." : gameType === "race" ? "The Race has a winner." : "The first light was found.")
      : expired
        ? "This Orb closed without a winner."
        : "This Orb is still live.";

  const description = winner
    ? gameType === "arena"
      ? <>{winnerIdentity}winner verified by the authoritative Arena service.</>
      : gameType === "race"
        ? <>{winnerIdentity}first verified three-lap finisher from the authoritative Race service.</>
        : <>{winnerIdentity}server-verified MAZE finish.</>
    : expired
      ? <>No verified winner was locked before this Orb&apos;s expiry. The on-chain refund path returns refundable prize funds only to the original host.</>
      : <>Winner state for <strong>{slug}</strong>. The prize remains in its isolated Anchor vault until Orbs locks one verified game winner.</>;

  return <div className="page"><div className="container"><div className="result">
    <Image src="/orbs-logo-256.png" width={256} height={256} alt=""/>
    <span className="eyebrow">{eyebrow}</span>
    <h1>{headline}</h1>
    <p className="muted">{description}</p>
    <div className="result-prize gradient-text">{prize}</div>
    {orb && winner?.wallet && (!expired || claimed) ? <ClaimPrizeButton slug={slug} winnerWallet={winner.wallet} hostWallet={orb.hostWallet} mint={orb.token.mint} orbId={orb.id} claimed={claimed} isNativeSol={orb.token.isNativeSol === true} /> : null}
    {orb && expired && !claimed ? <RefundPrizeButton slug={slug} /> : null}
    {!winner && !expired ? <button className="btn-primary" disabled>Waiting for a verified winner</button> : null}
    <div className="metrics">
      {gameType === "arena"
        ? <><div className="metric"><span>Game</span><strong>ARENA</strong></div><div className="metric"><span>Match time</span><strong>{formatTime(winner?.verifiedElapsedMs)}</strong></div><div className="metric"><span>Result proof</span><strong>{winner?.replayHash ? winner.replayHash.slice(0,12).toUpperCase() : "—"}</strong></div></>
        : gameType === "race"
          ? <><div className="metric"><span>Game</span><strong>RACE · 3 LAPS</strong></div><div className="metric"><span>Race time</span><strong>{formatTime(winner?.verifiedElapsedMs)}</strong></div><div className="metric"><span>Result proof</span><strong>{winner?.replayHash ? winner.replayHash.slice(0,12).toUpperCase() : "—"}</strong></div></>
          : <><div className="metric"><span>Finish time</span><strong>{formatTime(winner?.verifiedElapsedMs)}</strong></div><div className="metric"><span>Replay proof</span><strong>{winner?.replayHash ? winner.replayHash.slice(0,12).toUpperCase() : "—"}</strong></div><div className="metric"><span>Game</span><strong>MAZE</strong></div></>}
      <div className="metric"><span>Status</span><strong>{claimed ? "Claimed on-chain" : winner && !expired ? "Winner verified / claimable" : expired ? "Refund available" : "Live / pending"}</strong></div>
    </div>
    {winner?.claimTxSignature ? <p className="muted"><code>{winner.claimTxSignature.slice(0,12)}…{winner.claimTxSignature.slice(-12)}</code></p> : null}
    {orb && claimed && winner?.wallet ? <WinnerShareCard slug={slug} prize={prize} finishTime={formatTime(winner?.verifiedElapsedMs)} xUsername={winner?.xUsername} winnerWallet={winner.wallet} gameType={gameType} /> : null}
    <div className="hero-actions" style={{justifyContent:"center"}}><Link className="btn-secondary" href="/create">Create an Orb</Link><Link className="btn-ghost" href={`/orb/${slug}`}>Back to Orb →</Link></div>
  </div></div></div>;
}
