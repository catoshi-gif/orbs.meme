"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import ConnectWallet from "@/components/ConnectWallet";
import EligibilityGate from "@/components/EligibilityGate";
import TurnstileGate from "@/components/TurnstileGate";
import XConnect, { type XUser } from "@/components/XConnect";
import ArenaOrbIdentity from "@/components/ArenaOrbIdentity";
import type { OrbGameType } from "@/lib/orbStore";
import { canonicalPublicSiteUrl } from "@/lib/siteUrl";
import { xCashtag } from "@/lib/xShareText";

type Props = {
  slug: string;
  hostXId: string;
  hostUsername: string;
  createdAt: number;
  startsAt: number;
  endsAt: number;
  prizeTokenAmount: number;
  prizeUsd: number;
  tokenSymbol: string;
  gameType: OrbGameType;
};

const publicSiteUrl = canonicalPublicSiteUrl();

function money(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(value);
}

function amount(value: number) {
  return value.toLocaleString(undefined, { maximumFractionDigits: 6 });
}

function base64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function apiPayload<T extends { error?: string }>(response: Response): Promise<T> {
  const body = await response.text();
  if (!body) return {} as T;
  try { return JSON.parse(body) as T; } catch {
    const unavailable = response.status >= 500 || /bad gateway|cloudflare/i.test(body);
    return {
      error: unavailable
        ? "Post verification is temporarily unavailable. Your post is safe; wait a moment, then try again."
        : "The server returned an unreadable response. Please try again.",
    } as T;
  }
}

export default function OrbQualification({ slug, hostXId, hostUsername, createdAt, startsAt, endsAt, prizeTokenAmount, prizeUsd, tokenSymbol, gameType }: Props) {
  const { connected, publicKey, signMessage } = useWallet();
  const [xUser, setXUser] = useState<XUser | null>(null);
  const [followed, setFollowed] = useState(false);
  const [following, setFollowing] = useState(false);
  const [followError, setFollowError] = useState<string | null>(null);
  const [walletVerified, setWalletVerified] = useState(false);
  const [eligibilityConfirmed, setEligibilityConfirmed] = useState(false);
  const [verifyingWallet, setVerifyingWallet] = useState(false);
  const [walletError, setWalletError] = useState<string | null>(null);
  const [humanVerified, setHumanVerified] = useState(false);
  const [shareVerified, setShareVerified] = useState(false);
  const [shareStarted, setShareStarted] = useState(false);
  const [shareLine, setShareLine] = useState("");
  const [verifyingShare, setVerifyingShare] = useState(false);
  const [recoveringShare, setRecoveringShare] = useState(false);
  const recoveringShareRef = useRef(false);
  const [shareError, setShareError] = useState<string | null>(null);
  const [verifiedPostUrl, setVerifiedPostUrl] = useState<string | null>(null);
  const [shareCardReady, setShareCardReady] = useState(false);
  const [now, setNow] = useState(Date.now());
  const wallet = publicKey?.toBase58() || "";
  const orbShareUrl = `${publicSiteUrl}/orb/${encodeURIComponent(slug)}?v=${createdAt}`;
  const shareCardUrl = `${publicSiteUrl}/api/orbs/${encodeURIComponent(slug)}/share-card?v=${createdAt}`;

  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 500); return () => clearInterval(timer); }, []);

  useEffect(() => {
    let active = true;
    const image = new Image();
    setShareCardReady(false);
    image.onload = () => { if (active) setShareCardReady(true); };
    image.onerror = () => { if (active) setShareCardReady(false); };
    image.src = shareCardUrl;
    return () => { active = false; image.onload = null; image.onerror = null; };
  }, [shareCardUrl]);

  useEffect(() => {
    if (!xUser) { setFollowed(false); return; }
    fetch(`/api/x/follow?slug=${encodeURIComponent(slug)}`, { cache: "no-store" })
      .then((response) => response.json()).then((payload: { confirmed?: boolean }) => setFollowed(Boolean(payload.confirmed))).catch(() => setFollowed(false));
  }, [hostXId, xUser]);

  useEffect(() => {
    setWalletVerified(false);
    setHumanVerified(false);
    setShareVerified(false);
    if (!xUser || !wallet) return;
    fetch(`/api/orbs/${encodeURIComponent(slug)}/qualify/wallet?wallet=${encodeURIComponent(wallet)}`, { cache: "no-store" })
      .then((response) => response.json()).then((payload: { verified?: boolean }) => setWalletVerified(Boolean(payload.verified))).catch(() => setWalletVerified(false));
  }, [slug, wallet, xUser]);

  useEffect(() => {
    setShareVerified(false);
    setVerifiedPostUrl(null);
    if (!xUser || !wallet) return;
    fetch(`/api/orbs/${encodeURIComponent(slug)}/qualify/share?wallet=${encodeURIComponent(wallet)}`, { cache: "no-store" })
      .then((response) => response.json())
      .then((payload: { verified?: boolean; postUrl?: string | null }) => {
        setShareVerified(Boolean(payload.verified));
        setVerifiedPostUrl(payload.postUrl || null);
      })
      .catch(() => setShareVerified(false));
  }, [slug, wallet, xUser]);

  const followHost = async () => {
    setFollowing(true); setFollowError(null);
    try {
      const response = await fetch("/api/x/follow", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ slug }) });
      const payload = await response.json() as { confirmed?: boolean; pending?: boolean; error?: string };
      if (!response.ok) throw new Error(payload.error || "Could not follow host");
      if (payload.pending) throw new Error("This host requires follow approval. Public X accounts are required for Orbs hosts.");
      setFollowed(Boolean(payload.confirmed));
    } catch (error) { setFollowError(error instanceof Error ? error.message : "Could not follow host"); }
    finally { setFollowing(false); }
  };

  const verifyWallet = async () => {
    if (!wallet || !signMessage) { setWalletError("This wallet does not support message signing."); return; }
    setVerifyingWallet(true); setWalletError(null);
    try {
      const nonceResponse = await fetch(`/api/orbs/${encodeURIComponent(slug)}/qualify/wallet/nonce`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ wallet }) });
      const nonce = await nonceResponse.json() as { ok?: boolean; message?: string; error?: string };
      if (!nonceResponse.ok || !nonce.ok || !nonce.message) throw new Error(nonce.error || "Could not create wallet challenge");
      const signature = await signMessage(new TextEncoder().encode(nonce.message));
      const verifyResponse = await fetch(`/api/orbs/${encodeURIComponent(slug)}/qualify/wallet`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ wallet, signature: base64(signature) }) });
      const result = await verifyResponse.json() as { verified?: boolean; error?: string };
      if (!verifyResponse.ok || !result.verified) throw new Error(result.error || "Wallet verification failed");
      setWalletVerified(true);
    } catch (error) { setWalletError(error instanceof Error ? error.message : "Wallet verification failed"); }
    finally { setVerifyingWallet(false); }
  };

  const openShareComposer = async () => {
    const line = shareLine.trim();
    if (line.length < 12) { setShareError("Add one original line first so entry posts do not become repetitive spam."); return; }
    if (!shareCardReady) { setShareError("The X card is still preparing. Wait a moment, then post."); return; }
    setShareError(null);

    const postText = gameType === "arena"
      ? `${line}\n\nI’m entering @${hostUsername}’s ARENA for ${amount(prizeTokenAmount)} ${xCashtag(tokenSymbol.slice(0, 16))} (≈${money(prizeUsd)}). #contest`
      : `${line}\n\nI’m racing @${hostUsername} for ${amount(prizeTokenAmount)} ${xCashtag(tokenSymbol.slice(0, 16))} (≈${money(prizeUsd)}). First verified finish wins. #contest`;
    const params = new URLSearchParams({ text: postText, url: orbShareUrl });
    const composeUrl = `https://x.com/intent/post?${params.toString()}`;

    // Open a blank destination synchronously while the user's tap still owns a
    // browser activation. iOS wallet/dApp browsers may suspend this webview as
    // soon as X opens, so the durable server intent must finish first.
    const composer = window.open("about:blank", "_blank");

    try {
      const intentResponse = await fetch(`/api/orbs/${encodeURIComponent(slug)}/qualify/share`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ wallet, originalLine: line, mode: "intent" }),
        cache: "no-store",
      });
      const intent = await apiPayload<{ pending?: boolean; error?: string }>(intentResponse);
      if (!intentResponse.ok || !intent.pending) {
        try { composer?.close(); } catch {}
        throw new Error(intent.error || "Could not prepare X post verification");
      }

      try {
        localStorage.setItem(`orbs:share-intent:${slug}:${wallet}`, JSON.stringify({ startedAt: Date.now(), originalLine: line }));
      } catch {}

      if (composer && !composer.closed) composer.location.href = composeUrl;
      else window.location.href = composeUrl;
      setShareStarted(true);
    } catch (error) {
      try { composer?.close(); } catch {}
      setShareError(error instanceof Error ? error.message : "Could not prepare X post verification");
    }
  };

  const verifyShare = async () => {
    setVerifyingShare(true); setShareError(null);
    try {
      const response = await fetch(`/api/orbs/${encodeURIComponent(slug)}/qualify/share`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ wallet, originalLine: shareLine.trim() }),
      });
      const payload = await apiPayload<{ verified?: boolean; postUrl?: string; error?: string }>(response);
      if (!response.ok || !payload.verified) throw new Error(payload.error || "Could not verify your X post");
      setShareVerified(true);
      setVerifiedPostUrl(payload.postUrl || null);
    } catch (error) { setShareError(error instanceof Error ? error.message : "Could not verify your X post"); }
    finally { setVerifyingShare(false); }
  };


  const recoverShare = useCallback(async (quiet = false) => {
    if (!wallet || !xUser || shareVerified || recoveringShareRef.current) return;
    recoveringShareRef.current = true;
    setRecoveringShare(true);
    if (!quiet) setShareError(null);
    try {
      const response = await fetch(`/api/orbs/${encodeURIComponent(slug)}/qualify/share`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet, mode: "recover" }),
        cache: "no-store",
      });
      const payload = await apiPayload<{ verified?: boolean; pending?: boolean; postUrl?: string; error?: string }>(response);
      if (payload.verified) {
        setShareVerified(true);
        setVerifiedPostUrl(payload.postUrl || null);
        setShareStarted(true);
        setShareError(null);
        try { localStorage.removeItem(`orbs:share-intent:${slug}:${wallet}`); } catch {}
      } else if (payload.pending) {
        setShareStarted(true);
        if (!quiet && payload.error) setShareError(payload.error);
      }
    } catch (error) {
      if (!quiet) setShareError(error instanceof Error ? error.message : "Could not check X for your post");
    } finally {
      recoveringShareRef.current = false;
      setRecoveringShare(false);
    }
  }, [shareVerified, slug, wallet, xUser]);

  const onXChange = useCallback((next: XUser | null) => { setXUser(next); setHumanVerified(false); setShareVerified(false); }, []);
  const readyForHuman = Boolean(xUser && followed && connected && walletVerified && eligibilityConfirmed && wallet);
  const readyForShare = readyForHuman && humanVerified;
  const qualified = readyForShare && shareVerified;

  useEffect(() => {
    if (!readyForShare || shareVerified || !wallet || !xUser) return;

    let localIntent = false;
    try { localIntent = Boolean(localStorage.getItem(`orbs:share-intent:${slug}:${wallet}`)); } catch {}

    // Automatic recovery is reserved for browsers where this page itself
    // recorded a composer handoff. Manual "Check X" still works without this
    // marker, which covers iOS webviews that lost state during the handoff.
    if (localIntent) void recoverShare(true);

    const onReturn = () => {
      if (document.visibilityState !== "visible" || !localIntent) return;
      window.setTimeout(() => void recoverShare(true), 1200);
    };
    document.addEventListener("visibilitychange", onReturn);
    window.addEventListener("focus", onReturn);
    return () => {
      document.removeEventListener("visibilitychange", onReturn);
      window.removeEventListener("focus", onReturn);
    };
  }, [readyForShare, recoverShare, shareVerified, slug, wallet, xUser]);
  useEffect(() => {
    window.dispatchEvent(new CustomEvent("orbs:qualification-state", {
      detail: { slug, qualified, wallet: qualified ? wallet : "" },
    }));
  }, [slug, qualified, wallet]);
  const live = now >= startsAt;
  const arenaSyncOpen = gameType === "arena" && now >= startsAt - 60_000;
  const entryOpen = gameType === "arena" ? arenaSyncOpen : live;
  const closed = now >= endsAt;

  if (closed) return <aside className="card qualify orb-closed-card"><span className="eyebrow">Competition closed</span><h3>This Orb has expired.</h3><p className="muted">The six-hour race window ended. New qualification and entry are closed.</p><a className="btn-primary" href={`/orb/${slug}/results`}>View result →</a></aside>;

  return <aside id="qualify" className="card qualify">
    <span className="eyebrow">Before you play</span><h3>Register for this Orb.</h3>
    <p className="muted">Registration is required to play for the prize. Complete one X identity, one verified wallet, one 18+ eligibility receipt, one human check, and one real entry post. Nothing here moves funds.</p>
    <div className="q-list">
      <div className={`q-row ${xUser ? "ready" : ""}`}><span className="q-num">{xUser ? "✓" : "1"}</span><div style={{flex:1}}><strong>Connect X</strong><small>{xUser ? `@${xUser.username} connected` : "Your social identity for this competition"}</small></div><XConnect compact minimalConnected returnTo={`/orb/${slug}`} onChange={onXChange} /></div>
      <div className={`q-row ${followed ? "ready" : ""}`}><span className="q-num">{followed ? "✓" : "2"}</span><div style={{flex:1}}><strong>Follow @{hostUsername}</strong><small>{followed ? "Follow confirmed directly by X" : "One tap asks X to follow the Orb host from your connected account"}</small>{followError ? <small className="q-error">{followError}</small> : null}</div>{xUser && !followed ? <button className="mini-action" onClick={() => void followHost()} disabled={following}>{following ? "Following…" : "Follow on X"}</button> : null}</div>
      <div className={`q-row ${walletVerified ? "ready" : ""}`}><span className="q-num">{walletVerified ? "✓" : "3"}</span><div style={{flex:1}}><strong>{connected ? "Verify wallet" : "Connect wallet"}</strong><small>{walletVerified ? "Signed ownership proof ready" : connected ? "One free message signature · no transaction" : "This wallet becomes your winner identity"}</small>{walletError ? <small className="q-error">{walletError}</small> : null}</div>{!connected ? <ConnectWallet compact /> : !walletVerified ? <button className="mini-action" onClick={() => void verifyWallet()} disabled={verifyingWallet || !xUser}>{verifyingWallet ? "Signing…" : "Verify"}</button> : null}</div>
      <div className={`q-row q-row-stacked ${eligibilityConfirmed ? "ready" : ""}`}><span className="q-num">{eligibilityConfirmed ? "✓" : "4"}</span><div className="q-stack"><div className="q-copy"><strong>18+ eligibility</strong><small>{eligibilityConfirmed ? "Eligibility receipt saved for this wallet" : walletVerified ? "One-time neutral age check. Your date of birth is not stored." : "Verify your wallet first"}</small></div>{walletVerified ? <EligibilityGate compact onChange={setEligibilityConfirmed} /> : null}</div></div>
      <div className={`q-row q-row-stacked q-human ${humanVerified ? "ready" : ""}`}><span className="q-num">{humanVerified ? "✓" : "5"}</span><div className="q-stack"><div className="q-copy"><strong>Human check</strong><small>{humanVerified ? "Cloudflare challenge verified" : readyForHuman ? "Complete the quick anti-bot check below." : "Finish the steps above to unlock the human check."}</small></div><TurnstileGate key={`${slug}:${xUser?.id || "none"}:${wallet}`} slug={slug} wallet={wallet} enabled={readyForHuman} onVerified={setHumanVerified} /></div></div>
      <div className={`q-row q-share ${shareVerified ? "ready" : ""}`}><span className="q-num">{shareVerified ? "✓" : "6"}</span><div className="q-copy"><strong>Share your entry</strong><small>{shareVerified ? "Orb post verified directly from your X account" : recoveringShare ? "Checking your X account for the entry post you already made…" : readyForShare ? shareStarted ? "Already posted? Orbs can find and verify it without making you post again." : shareCardReady ? "Add your own line and post the waiting-room card. Orbs will check X when you return." : "Preparing the X card before posting…" : "Complete the human check first"}</small>{shareError ? <small className="q-error">{shareError}</small> : null}{shareVerified && verifiedPostUrl ? <a className="q-post-link" href={verifiedPostUrl} target="_blank" rel="noreferrer">View verified post ↗</a> : null}</div>{readyForShare && !shareVerified ? <div className="q-share-actions"><input value={shareLine} onChange={(event) => setShareLine(event.target.value.slice(0, 70))} maxLength={70} placeholder="Why are you going to win?" aria-label="Your original line for the X post" />{shareStarted ? <><button className="mini-action" onClick={() => void recoverShare(false)} disabled={recoveringShare}>{recoveringShare ? "Checking X…" : "Check X for my post"}</button><button className="q-compose-again" onClick={openShareComposer} disabled={!shareCardReady || shareLine.trim().length < 12}>Open composer again</button><a className="q-compose-again" href={shareCardUrl} download={`orbs-${slug}.jpg`} target="_blank" rel="noreferrer">Save card if X delays preview</a></> : <><button className="mini-action" onClick={openShareComposer} disabled={!shareCardReady}>{shareCardReady ? "Post on X" : "Preparing card…"}</button><button className="q-compose-again" onClick={() => void recoverShare(false)} disabled={recoveringShare}>{recoveringShare ? "Checking X…" : "Already posted? Check X"}</button><a className="q-compose-again" href={shareCardUrl} download={`orbs-${slug}.jpg`} target="_blank" rel="noreferrer">Save card</a></>}</div> : null}</div>
    </div>
    {qualified && gameType === "arena" ? <ArenaOrbIdentity slug={slug} wallet={wallet} /> : null}
    <a className={`btn-primary qualify-play ${qualified && entryOpen ? "" : "disabled"}`} href={qualified && entryOpen ? `/orb/${slug}/play?wallet=${encodeURIComponent(wallet)}` : undefined} aria-disabled={!qualified || !entryOpen}>{qualified && entryOpen ? gameType === "arena" ? (live ? "Enter Arena →" : "Synchronize Arena →") : "Enter live Orb →" : qualified && gameType === "arena" ? "Arena opens 60 sec before launch" : live ? "Finish registration" : "Game opens at launch"}</a>
  </aside>;
}
