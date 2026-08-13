"use client";

import { useCallback, useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import ConnectWallet from "@/components/ConnectWallet";
import TurnstileGate from "@/components/TurnstileGate";
import XConnect, { type XUser } from "@/components/XConnect";

type Props = { slug: string; hostXId: string; hostUsername: string; startsAt: number };

function base64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export default function OrbQualification({ slug, hostXId, hostUsername, startsAt }: Props) {
  const { connected, publicKey, signMessage } = useWallet();
  const [xUser, setXUser] = useState<XUser | null>(null);
  const [followed, setFollowed] = useState(false);
  const [following, setFollowing] = useState(false);
  const [followError, setFollowError] = useState<string | null>(null);
  const [walletVerified, setWalletVerified] = useState(false);
  const [verifyingWallet, setVerifyingWallet] = useState(false);
  const [walletError, setWalletError] = useState<string | null>(null);
  const [humanVerified, setHumanVerified] = useState(false);
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
    if (!xUser || !wallet) return;
    fetch(`/api/orbs/${encodeURIComponent(slug)}/qualify/wallet?wallet=${encodeURIComponent(wallet)}`, { cache: "no-store" })
      .then((response) => response.json()).then((payload: { verified?: boolean }) => setWalletVerified(Boolean(payload.verified))).catch(() => setWalletVerified(false));
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

  const onXChange = useCallback((next: XUser | null) => { setXUser(next); setHumanVerified(false); }, []);
  const readyForHuman = Boolean(xUser && followed && connected && walletVerified && wallet);
  const qualified = readyForHuman && humanVerified;
  const live = now >= startsAt;

  return <aside id="qualify" className="card qualify">
    <span className="eyebrow">Before you play</span><h3>Qualify for this Orb.</h3>
    <p className="muted">One X identity, one verified wallet, one human check. Nothing here moves funds.</p>
    <div className="q-list">
      <div className={`q-row ${xUser ? "ready" : ""}`}><span className="q-num">{xUser ? "✓" : "1"}</span><div style={{flex:1}}><strong>Connect X</strong><small>{xUser ? `@${xUser.username} connected` : "Your social identity for this competition"}</small></div>{!xUser ? <XConnect compact returnTo={`/orb/${slug}`} onChange={onXChange} /> : null}</div>
      <div className={`q-row ${followed ? "ready" : ""}`}><span className="q-num">{followed ? "✓" : "2"}</span><div style={{flex:1}}><strong>Follow @{hostUsername}</strong><small>{followed ? "Follow confirmed directly by X" : "One tap asks X to follow the Orb host from your connected account"}</small>{followError ? <small className="q-error">{followError}</small> : null}</div>{xUser && !followed ? <button className="mini-action" onClick={() => void followHost()} disabled={following}>{following ? "Following…" : "Follow on X"}</button> : null}</div>
      <div className={`q-row ${walletVerified ? "ready" : ""}`}><span className="q-num">{walletVerified ? "✓" : "3"}</span><div style={{flex:1}}><strong>{connected ? "Verify wallet" : "Connect wallet"}</strong><small>{walletVerified ? "Signed ownership proof ready" : connected ? "One free message signature · no transaction" : "This wallet becomes your winner identity"}</small>{walletError ? <small className="q-error">{walletError}</small> : null}</div>{!connected ? <ConnectWallet compact /> : !walletVerified ? <button className="mini-action" onClick={() => void verifyWallet()} disabled={verifyingWallet || !xUser}>{verifyingWallet ? "Signing…" : "Verify"}</button> : null}</div>
      <div className={`q-row q-human ${humanVerified ? "ready" : ""}`}><span className="q-num">{humanVerified ? "✓" : "4"}</span><div style={{flex:1}}><strong>Human check</strong><small>{humanVerified ? "Cloudflare challenge verified" : "Bot resistance before a competitive session is issued"}</small><TurnstileGate key={`${slug}:${xUser?.id || "none"}:${wallet}`} slug={slug} wallet={wallet} enabled={readyForHuman} onVerified={setHumanVerified} /></div></div>
    </div>
    <a className={`btn-primary qualify-play ${qualified && live ? "" : "disabled"}`} href={qualified && live ? `/orb/${slug}/play?wallet=${encodeURIComponent(wallet)}` : undefined} aria-disabled={!qualified || !live}>{live ? qualified ? "Enter live Orb →" : "Finish qualification" : "Game opens at launch"}</a>
  </aside>;
}
