"use client";

import { useCallback, useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import ConnectWallet from "@/components/ConnectWallet";
import TurnstileGate from "@/components/TurnstileGate";
import XConnect, { type XUser } from "@/components/XConnect";

type Props = {
  slug: string;
  hostXId: string;
  hostUsername: string;
  startsAt: number;
  prizeTokenAmount: number;
  prizeUsd: number;
  tokenSymbol: string;
};

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

export default function OrbQualification({ slug, hostXId, hostUsername, startsAt, prizeTokenAmount, prizeUsd, tokenSymbol }: Props) {
  const { connected, publicKey, signMessage } = useWallet();
  const [xUser, setXUser] = useState<XUser | null>(null);
  const [followed, setFollowed] = useState(false);
  const [following, setFollowing] = useState(false);
  const [followError, setFollowError] = useState<string | null>(null);
  const [walletVerified, setWalletVerified] = useState(false);
  const [verifyingWallet, setVerifyingWallet] = useState(false);
  const [walletError, setWalletError] = useState<string | null>(null);
  const [humanVerified, setHumanVerified] = useState(false);
  const [shareVerified, setShareVerified] = useState(false);
  const [shareStarted, setShareStarted] = useState(false);
  const [shareLine, setShareLine] = useState("");
  const [verifyingShare, setVerifyingShare] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);
  const [verifiedPostUrl, setVerifiedPostUrl] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const wallet = publicKey?.toBase58() || "";

  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 500); return () => clearInterval(timer); }, []);

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

  const openShareComposer = () => {
    const line = shareLine.trim();
    if (line.length < 12) { setShareError("Add one original line first so entry posts do not become repetitive spam."); return; }
    setShareError(null);
    const orbUrl = `${window.location.origin}/orb/${slug}`;
    const text = `${line}\n\nI’m racing @${hostUsername} for ${amount(prizeTokenAmount)} ${tokenSymbol.slice(0, 16)} (≈${money(prizeUsd)}). First verified finish wins.\n\n${orbUrl}`;
    window.open(`https://x.com/intent/post?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
    setShareStarted(true);
  };

  const verifyShare = async () => {
    setVerifyingShare(true); setShareError(null);
    try {
      const response = await fetch(`/api/orbs/${encodeURIComponent(slug)}/qualify/share`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet, originalLine: shareLine.trim() }),
      });
      const payload = await response.json() as { verified?: boolean; postUrl?: string; error?: string };
      if (!response.ok || !payload.verified) throw new Error(payload.error || "Could not verify your X post");
      setShareVerified(true);
      setVerifiedPostUrl(payload.postUrl || null);
    } catch (error) { setShareError(error instanceof Error ? error.message : "Could not verify your X post"); }
    finally { setVerifyingShare(false); }
  };

  const onXChange = useCallback((next: XUser | null) => { setXUser(next); setHumanVerified(false); setShareVerified(false); }, []);
  const readyForHuman = Boolean(xUser && followed && connected && walletVerified && wallet);
  const readyForShare = readyForHuman && humanVerified;
  const qualified = readyForShare && shareVerified;
  const live = now >= startsAt;

  return <aside id="qualify" className="card qualify">
    <span className="eyebrow">Before you play</span><h3>Qualify for this Orb.</h3>
    <p className="muted">One X identity, one verified wallet, one human check, one real entry post. Nothing here moves funds.</p>
    <div className="q-list">
      <div className={`q-row ${xUser ? "ready" : ""}`}><span className="q-num">{xUser ? "✓" : "1"}</span><div style={{flex:1}}><strong>Connect X</strong><small>{xUser ? `@${xUser.username} connected` : "Your social identity for this competition"}</small></div>{!xUser ? <XConnect compact returnTo={`/orb/${slug}`} onChange={onXChange} /> : null}</div>
      <div className={`q-row ${followed ? "ready" : ""}`}><span className="q-num">{followed ? "✓" : "2"}</span><div style={{flex:1}}><strong>Follow @{hostUsername}</strong><small>{followed ? "Follow confirmed directly by X" : "One tap asks X to follow the Orb host from your connected account"}</small>{followError ? <small className="q-error">{followError}</small> : null}</div>{xUser && !followed ? <button className="mini-action" onClick={() => void followHost()} disabled={following}>{following ? "Following…" : "Follow on X"}</button> : null}</div>
      <div className={`q-row ${walletVerified ? "ready" : ""}`}><span className="q-num">{walletVerified ? "✓" : "3"}</span><div style={{flex:1}}><strong>{connected ? "Verify wallet" : "Connect wallet"}</strong><small>{walletVerified ? "Signed ownership proof ready" : connected ? "One free message signature · no transaction" : "This wallet becomes your winner identity"}</small>{walletError ? <small className="q-error">{walletError}</small> : null}</div>{!connected ? <ConnectWallet compact /> : !walletVerified ? <button className="mini-action" onClick={() => void verifyWallet()} disabled={verifyingWallet || !xUser}>{verifyingWallet ? "Signing…" : "Verify"}</button> : null}</div>
      <div className={`q-row q-human ${humanVerified ? "ready" : ""}`}><span className="q-num">{humanVerified ? "✓" : "4"}</span><div className="q-copy"><strong>Human check</strong><small>{humanVerified ? "Cloudflare challenge verified" : "Bot resistance before a competitive session is issued"}</small></div><TurnstileGate key={`${slug}:${xUser?.id || "none"}:${wallet}`} slug={slug} wallet={wallet} enabled={readyForHuman} onVerified={setHumanVerified} /></div>
      <div className={`q-row q-share ${shareVerified ? "ready" : ""}`}><span className="q-num">{shareVerified ? "✓" : "5"}</span><div className="q-copy"><strong>Share your entry</strong><small>{shareVerified ? "Orb post verified directly from your X account" : readyForShare ? "Add your own line, post the Orb card, then verify it here" : "Complete the human check first"}</small>{shareError ? <small className="q-error">{shareError}</small> : null}{shareVerified && verifiedPostUrl ? <a className="q-post-link" href={verifiedPostUrl} target="_blank" rel="noreferrer">View verified post ↗</a> : null}</div>{readyForShare && !shareVerified ? <div className="q-share-actions"><input value={shareLine} onChange={(event) => setShareLine(event.target.value.slice(0, 70))} maxLength={70} placeholder="Why are you going to win?" aria-label="Your original line for the X post" />{shareStarted ? <><button className="mini-action" onClick={() => void verifyShare()} disabled={verifyingShare}>{verifyingShare ? "Checking…" : "Verify post"}</button><button className="q-compose-again" onClick={openShareComposer}>Open composer again</button></> : <button className="mini-action" onClick={openShareComposer}>Post on X</button>}</div> : null}</div>
    </div>
    <a className={`btn-primary qualify-play ${qualified && live ? "" : "disabled"}`} href={qualified && live ? `/orb/${slug}/play?wallet=${encodeURIComponent(wallet)}` : undefined} aria-disabled={!qualified || !live}>{live ? qualified ? "Enter live Orb →" : "Finish qualification" : "Game opens at launch"}</a>
  </aside>;
}
