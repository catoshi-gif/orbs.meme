"use client";

import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { xCashtagPrize } from "@/lib/xShareText";

export default function WinnerShareCard({ slug, prize, finishTime, xUsername, winnerWallet, gameType = "maze" }: {
  slug: string;
  prize: string;
  finishTime: string;
  xUsername?: string;
  winnerWallet: string;
  gameType?: "maze" | "arena" | "race";
}) {
  const { publicKey } = useWallet();
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const isWinnerWallet = publicKey?.toBase58() === winnerWallet;

  // Keep the winner celebration private to the connected winning wallet. The
  // dedicated share URL remains public so X/social crawlers can render the OG card.
  if (!isWinnerWallet) return null;

  const cardUrl = `/api/orbs/${encodeURIComponent(slug)}/winner-card`;
  const text = gameType === "arena" ? `I won ${xCashtagPrize(prize)} in ORBS ARENA 🪐\n\n#ContestWinner` : gameType === "race" ? `I won ${xCashtagPrize(prize)} in ORBS RACE 🪐\n\nThree laps. First across. #ContestWinner` : `I won ${xCashtagPrize(prize)} in an Orbs MAZE 🪐\n\nVerified finish: ${finishTime}\n\n#ContestWinner`;
  const sharePageUrl = `${typeof window === "undefined" ? "" : window.location.origin}/orb/${encodeURIComponent(slug)}/winner`;

  const shareX = () => {
    const url = `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(sharePageUrl)}`;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const nativeShare = async () => {
    if (!navigator.share) return shareX();
    try {
      // On browsers that support file sharing (notably modern iOS), include the
      // actual victory image as well as the public verified-win URL.
      const response = await fetch(cardUrl, { cache: "no-store" });
      if (response.ok) {
        const blob = await response.blob();
        const file = new File([blob], `orbs-${slug}-winner.jpg`, { type: blob.type || "image/jpeg" });
        if (navigator.canShare?.({ files: [file] })) {
          await navigator.share({ title: "Verified Orbs Win", text, url: sharePageUrl, files: [file] });
          return;
        }
      }
      await navigator.share({ title: "Verified Orbs Win", text, url: sharePageUrl });
    } catch {}
  };

  return <section className="winner-share">
    <div className="winner-share-copy">
      <span className="eyebrow">Your Victory Lap</span>
      <h2>Flaunt the Win.</h2>
      <p>Your prize is claimed onchain. Sharing is completely optional and never affects your prize.</p>
    </div>
    <div className="share-card-preview winner-card-preview">
      <img src={cardUrl} alt={`${xUsername ? `@${xUsername} ` : ""}Orbs contest winner card`} onLoad={() => { setReady(true); setFailed(false); }} onError={() => { setReady(false); setFailed(true); }} />
      <div>
        <strong>{ready ? "Winner card ready ✨" : failed ? "The winner card could not be prepared." : "Polishing your winner card…"}</strong>
        <span>The card identifies this as a contest win and links back to the public verified result. No wallet address is printed on it.</span>
      </div>
      <div className="share-actions">
        <button className="btn-primary" onClick={() => void nativeShare()} disabled={!ready}>Share Your Win</button>
        <button className="btn-secondary" onClick={shareX} disabled={!ready}>Post on X</button>
        <a className="btn-ghost" href={cardUrl} download={`orbs-${slug}-winner.jpg`} target="_blank" rel="noreferrer">Save Card</a>
      </div>
    </div>
    <p className="winner-share-disclosure">Optional share · no additional reward for posting · generated copy includes #ContestWinner</p>
  </section>;
}
