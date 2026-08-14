"use client";

import { useState } from "react";

export default function WinnerShareCard({ slug, prize, finishTime, xUsername }: { slug: string; prize: string; finishTime: string; xUsername?: string }) {
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const cardUrl = `/api/orbs/${encodeURIComponent(slug)}/winner-card`;
  const text = `i won ${prize} on orbs.meme 🪐\n\nfinish: ${finishTime}\n\n#contestwinner`;
  const shareX = () => {
    const resultUrl = `${window.location.origin}/orb/${slug}/results`;
    const url = `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(resultUrl)}`;
    window.open(url, "_blank", "noopener,noreferrer");
  };
  const nativeShare = async () => {
    if (!navigator.share) return shareX();
    const resultUrl = `${window.location.origin}/orb/${slug}/results`;
    try { await navigator.share({ title: "i won an orb", text, url: resultUrl }); } catch {}
  };
  return <section className="winner-share">
    <div className="winner-share-copy"><span className="eyebrow">your victory lap</span><h2>flaunt the win.</h2><p>your prize is claimed onchain. sharing is completely optional and never affects your prize.</p></div>
    <div className="share-card-preview winner-card-preview">
      <img src={cardUrl} alt={`${xUsername ? `@${xUsername} ` : ""}Orbs contest winner card`} onLoad={() => { setReady(true); setFailed(false); }} onError={() => { setReady(false); setFailed(true); }} />
      <div><strong>{ready ? "winner card ready ✨" : failed ? "the winner card could not be prepared." : "polishing your winner card…"}</strong><span>the card identifies this as a contest win and links back to the public result. no wallet address is printed on it.</span></div>
      <div className="share-actions">
        <button className="btn-primary" onClick={() => void nativeShare()} disabled={!ready}>share your win</button>
        <button className="btn-secondary" onClick={shareX} disabled={!ready}>post on x</button>
        <a className="btn-ghost" href={cardUrl} download={`orbs-${slug}-winner.jpg`} target="_blank" rel="noreferrer">save card</a>
      </div>
    </div>
    <p className="winner-share-disclosure">optional share · no additional reward for posting · generated copy includes #contestwinner</p>
  </section>;
}
