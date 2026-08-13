"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { Connection, Transaction } from "@solana/web3.js";
import ConnectWallet from "@/components/ConnectWallet";
import XConnect, { type XUser } from "@/components/XConnect";
import TokenPicker, { type WalletSplToken } from "@/components/TokenPicker";
import { DEFAULT_GAME_STYLE, GAME_STYLE_PRESETS } from "@/game/constants";
import { MIN_PRIZE_USD, MIN_WALLET_REQUIREMENT_USD, ORBS_FEE_USD, feeTokenAmountForPrice, maxPrizeInputFromQuote, tokenInputToRaw } from "@/lib/prizeEconomics";
import { ORB_CREATION_MIN_LEAD_MS } from "@/lib/orbLifecycle";
import { canonicalPublicSiteUrl } from "@/lib/siteUrl";
import type { DifficultyKey, GameStyle } from "@/game/types";

const names = ["Identity", "Prize", "Game", "Launch", "Review", "Share"];
const publicSiteUrl = canonicalPublicSiteUrl();
const profiles: { key: DifficultyKey; name: string; label: string; time: string }[] = [
  { key: "quick", name: "Quick", label: "Easy", time: "~5 min" },
  { key: "classic", name: "Classic", label: "Medium", time: "~10 min" },
  { key: "brutal", name: "Brutal", label: "Hard", time: "~15 min" },
];

function localInputParts(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return { date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`, time: `${pad(date.getHours())}:${pad(date.getMinutes())}` };
}

function money(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value || 0);
}

function amount(value: number) {
  return value.toLocaleString(undefined, { maximumFractionDigits: 6 });
}

type CreatedOrb = { slug: string; commitment: string; createdAt: number; startsAt: number };
type CreationPolicy = { adminExempt: boolean; activeOrb: CreatedOrb | null };

async function jsonPayload<T>(response: Response): Promise<T> {
  const text = await response.text();
  try { return JSON.parse(text) as T; }
  catch { throw new Error(response.ok ? "The server returned an invalid response" : `The server is temporarily unavailable (${response.status})`); }
}

export default function CreateWizard() {
  const initialLaunch = useMemo(() => localInputParts(new Date(Date.now() + 24 * 60 * 60 * 1000)), []);
  const [step, setStep] = useState(0);
  const [difficulty, setDifficulty] = useState<DifficultyKey>("classic");
  const [style, setStyle] = useState<GameStyle>(DEFAULT_GAME_STYLE);
  const [xUser, setXUser] = useState<XUser | null>(null);
  const [token, setToken] = useState<WalletSplToken | null>(null);
  const [prizeInput, setPrizeInput] = useState("");
  const [launchDate, setLaunchDate] = useState(initialLaunch.date);
  const [launchTime, setLaunchTime] = useState(initialLaunch.time);
  const [fundingAcknowledged, setFundingAcknowledged] = useState(false);
  const [maxSelected, setMaxSelected] = useState(false);
  const [reviewRefreshing, setReviewRefreshing] = useState(false);
  const [reviewRefreshError, setReviewRefreshError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createdOrb, setCreatedOrb] = useState<CreatedOrb | null>(null);
  const [pendingOrb, setPendingOrb] = useState<CreatedOrb | null>(null);
  const [copied, setCopied] = useState(false);
  const [shareCardReady, setShareCardReady] = useState(false);
  const [shareCardFailed, setShareCardFailed] = useState(false);
  const [creationPolicy, setCreationPolicy] = useState<CreationPolicy | null>(null);
  const { connected, publicKey, signMessage, signTransaction } = useWallet();

  const prizeAmount = Number(prizeInput || 0);
  const quote = token?.prizeQuote || null;
  const quotedUsdPrice = quote?.usdPrice || token?.usdPrice || 0;
  const prizeUsd = quotedUsdPrice ? prizeAmount * quotedUsdPrice : 0;
  const feeTokenAmount = quote?.feeTokenAmount ?? feeTokenAmountForPrice(quotedUsdPrice);
  const totalTokenAmount = prizeAmount + feeTokenAmount;
  const totalUsd = prizeAmount > 0 ? prizeUsd + ORBS_FEE_USD : MIN_WALLET_REQUIREMENT_USD;
  const maxPrizeInput = token && quote ? maxPrizeInputFromQuote(token.rawAmount, quote.feeRawAmount, token.decimals) : "";
  const maxPrizeAmount = Number(maxPrizeInput || 0);
  const maxPrizeUsd = quotedUsdPrice ? maxPrizeAmount * quotedUsdPrice : 0;
  const prizeRaw = token ? tokenInputToRaw(prizeInput || "0", token.decimals) : null;
  const rawCoverageReady = Boolean(token && quote && prizeRaw !== null && /^\d+$/.test(quote.feeRawAmount) && prizeRaw + BigInt(quote.feeRawAmount) <= BigInt(token.rawAmount));
  const launchMs = new Date(`${launchDate}T${launchTime}:00`).getTime();
  const creationBlocked = Boolean(creationPolicy?.activeOrb && !creationPolicy.adminExempt);
  const identityReady = connected && Boolean(publicKey) && Boolean(signMessage) && Boolean(signTransaction) && Boolean(xUser && !xUser.protected) && !creationBlocked;
  const prizeReady = Boolean(token?.eligible && quote && prizeAmount > 0 && prizeUsd >= MIN_PRIZE_USD && rawCoverageReady);
  const launchReady = Number.isFinite(launchMs) && launchMs > Date.now() + ORB_CREATION_MIN_LEAD_MS;

  useEffect(() => {
    setCreationPolicy(null);
    const wallet = publicKey?.toBase58();
    if (!wallet) return;
    const controller = new AbortController();
    fetch(`/api/orbs?wallet=${encodeURIComponent(wallet)}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const payload = await jsonPayload<{ ok?: boolean; creationPolicy?: CreationPolicy; error?: string }>(response);
        if (!response.ok || !payload.ok || !payload.creationPolicy) throw new Error(payload.error || "Could not check this wallet's Orb status");
        setCreationPolicy(payload.creationPolicy);
      })
      .catch((cause) => { if (!(cause instanceof Error && cause.name === "AbortError")) setCreateError(cause instanceof Error ? cause.message : "Could not check this wallet's Orb status"); });
    return () => controller.abort();
  }, [publicKey]);

  const previewHref = useMemo(() => {
    const q = new URLSearchParams({ difficulty, marble: style.marble, marble2: style.marbleSecondary, walls: style.walls, floor: style.floor, accent: style.accent });
    return `/orb/demo/play?${q.toString()}`;
  }, [difficulty, style]);

  const colorField = (key: keyof GameStyle, label: string) => (
    <div className="field game-color-field"><label>{label}</label><div className="color-input-wrap"><input type="color" value={style[key]} onChange={(event) => setStyle((current) => ({ ...current, [key]: event.target.value }))} /><span>{style[key].toUpperCase()}</span></div></div>
  );

  const canContinue = step === 0 ? identityReady : step === 1 ? prizeReady : step === 3 ? launchReady : step < 4;

  const handleTokenChange = (next: WalletSplToken | null) => {
    const sameMint = Boolean(next && token && next.mint === token.mint);
    setToken(next);
    if (!sameMint) {
      setPrizeInput("");
      setMaxSelected(false);
      setFundingAcknowledged(false);
      return;
    }
    if (maxSelected && next?.prizeQuote) {
      setPrizeInput(maxPrizeInputFromQuote(next.rawAmount, next.prizeQuote.feeRawAmount, next.decimals));
    }
    setFundingAcknowledged(false);
  };

  const setPrize = (value: string) => {
    setPrizeInput(value);
    setMaxSelected(false);
    setFundingAcknowledged(false);
  };

  const useMaxPrize = () => {
    if (!token || !quote || !maxPrizeInput) return;
    setPrizeInput(maxPrizeInput);
    setMaxSelected(true);
    setFundingAcknowledged(false);
  };

  const refreshFundingForReview = async () => {
    if (!publicKey || !token) { setStep(4); return; }
    setReviewRefreshing(true);
    setReviewRefreshError(null);
    try {
      const wallet = publicKey.toBase58();
      const response = await fetch(`/api/wallet/tokens?wallet=${encodeURIComponent(wallet)}&t=${Date.now()}`, { cache: "no-store" });
      const payload = await response.json() as { ok?: boolean; tokens?: WalletSplToken[]; error?: string };
      if (!response.ok || !payload.ok) throw new Error(payload.error || "Could not refresh funding quote");
      const fresh = (payload.tokens || []).find((candidate) => candidate.mint === token.mint) || null;
      if (!fresh?.eligible || !fresh.prizeQuote) throw new Error(`${token.symbol} is no longer available as a priced prize token in this wallet`);
      setToken(fresh);
      if (maxSelected) setPrizeInput(maxPrizeInputFromQuote(fresh.rawAmount, fresh.prizeQuote.feeRawAmount, fresh.decimals));
      setFundingAcknowledged(false);
      setStep(4);
    } catch (error) {
      setReviewRefreshError(error instanceof Error ? error.message : "Could not refresh funding quote");
    } finally {
      setReviewRefreshing(false);
    }
  };

  const fundPendingOrb = async (orb: CreatedOrb) => {
    if (!signTransaction) throw new Error("This wallet cannot sign Solana transactions");
    const rpc = (process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "").trim();
    if (!rpc) throw new Error("NEXT_PUBLIC_SOLANA_RPC_URL is not configured");
    const fundingResponse = await fetch(`/api/orbs/${encodeURIComponent(orb.slug)}/funding`, { method: "POST" });
    const fundingPayload = await jsonPayload<{ ok?: boolean; alreadyFunded?: boolean; orb?: CreatedOrb; funding?: { transactionBase64: string; blockhash: string; lastValidBlockHeight: number }; error?: string }>(fundingResponse);
    if (!fundingResponse.ok || !fundingPayload.ok) throw new Error(fundingPayload.error || "Could not prepare the funding transaction");
    if (fundingPayload.alreadyFunded && fundingPayload.orb) {
      setPendingOrb(null);
      setCreatedOrb(fundingPayload.orb);
      setStep(5);
      return;
    }
    if (!fundingPayload.funding) throw new Error("Could not prepare the funding transaction");
    const bytes = Uint8Array.from(atob(fundingPayload.funding.transactionBase64), (char) => char.charCodeAt(0));
    const transaction = Transaction.from(bytes);
    const signed = await signTransaction(transaction);
    const connection = new Connection(rpc, "confirmed");
    const signature = await connection.sendRawTransaction(signed.serialize(), { skipPreflight: false, maxRetries: 3 });
    const confirmation = await connection.confirmTransaction({
      signature,
      blockhash: fundingPayload.funding.blockhash,
      lastValidBlockHeight: fundingPayload.funding.lastValidBlockHeight,
    }, "confirmed");
    if (confirmation.value.err) throw new Error("Solana rejected the Orb funding transaction");
    const confirmResponse = await fetch(`/api/orbs/${encodeURIComponent(orb.slug)}/funding/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ signature }),
    });
    const confirmed = await jsonPayload<{ ok?: boolean; orb?: CreatedOrb; error?: string }>(confirmResponse);
    if (!confirmResponse.ok || !confirmed.ok || !confirmed.orb) throw new Error(confirmed.error || "Funding confirmed on Solana but Orbs could not verify the escrow state");
    setPendingOrb(null);
    setCreatedOrb(confirmed.orb);
    setStep(5);
  };

  const createOrb = async () => {
    if (!publicKey || !signMessage || !signTransaction || !token || !identityReady || !prizeReady || !launchReady || !fundingAcknowledged) return;
    setCreating(true); setCreateError(null);
    try {
      if (pendingOrb) { await fundPendingOrb(pendingOrb); return; }
      const nonceResponse = await fetch("/api/orbs/create/nonce", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          wallet: publicKey.toBase58(),
          mint: token.mint,
          prizeTokenAmount: prizeInput,
          prizeQuoteToken: quote?.token,
          startsAt: launchMs,
        }),
      });
      const nonce = await jsonPayload<{ ok?: boolean; message?: string; error?: string }>(nonceResponse);
      if (!nonceResponse.ok || !nonce.ok || !nonce.message) throw new Error(nonce.error || "Could not authorize this host wallet");
      const signatureBytes = await signMessage(new TextEncoder().encode(nonce.message));
      const hostAuthorizationSignature = window.btoa(String.fromCharCode(...signatureBytes));
      const response = await fetch("/api/orbs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hostWallet: publicKey.toBase58(), hostAuthorizationSignature, mint: token.mint, prizeTokenAmount: prizeInput, prizeQuoteToken: quote?.token, difficulty, style, startsAt: launchMs }),
      });
      const payload = await jsonPayload<{ ok?: boolean; orb?: CreatedOrb; error?: string }>(response);
      if (!response.ok || !payload.ok || !payload.orb) throw new Error(payload.error || "Could not seal Orb funding parameters");
      setPendingOrb(payload.orb);
      await fundPendingOrb(payload.orb);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not fund Orb";
      if (/quote expired|funding record was not found/i.test(message)) setPendingOrb(null);
      setCreateError(message);
    } finally { setCreating(false); }
  };

  const shareUrl = createdOrb ? `${publicSiteUrl}/orb/${encodeURIComponent(createdOrb.slug)}?v=${createdOrb.createdAt}` : "";
  const shareCardUrl = createdOrb ? `${publicSiteUrl}/api/orbs/${encodeURIComponent(createdOrb.slug)}/share-card?v=${createdOrb.createdAt}` : "";
  const hostShareText = `I just sealed an Orb for ${amount(prizeAmount)} ${token?.symbol || "SPL"} (≈${money(prizeUsd)}). First verified finish wins.\n\nJoin the waiting room and bring your fastest run.`;
  const hostShareParams = new URLSearchParams({ text: hostShareText, url: shareUrl });

  useEffect(() => {
    setShareCardReady(false);
    setShareCardFailed(false);
  }, [createdOrb?.slug]);

  return (
    <div className="wizard-layout">
      <aside className="wizard-nav">{names.map((name, i) => <button key={name} className={step === i ? "active" : ""} disabled={i === 5 && !createdOrb} onClick={() => { if (i === 4 && token && publicKey) { void refreshFundingForReview(); return; } if (i !== 5 || createdOrb) setStep(i); }}>{i + 1}. {name}</button>)}</aside>
      <section className="wizard">
        {step === 0 ? <>
          <span className="eyebrow">Step 1 of 6</span><h2>Who is hosting?</h2>
          <p>Connect the Solana wallet that will fund the prize and the public X account whose community will play it.</p>
          <div className="fields"><div className="field full"><label>Solana wallet</label>{connected ? <div className="q-row ready"><span className="q-num">✓</span><div><strong>Wallet connected</strong><small>{publicKey?.toBase58().slice(0, 6)}…{publicKey?.toBase58().slice(-6)}</small></div></div> : <ConnectWallet />}{connected && (!signMessage || !signTransaction) ? <small className="field-warning">This wallet must support both message signing and Solana transaction signing to create an Orb.</small> : null}{creationBlocked && creationPolicy?.activeOrb ? <div className="active-orb-warning"><strong>One Orb is already active.</strong><span>This wallet can create its next Orb after the current race closes.</span><Link href={`/orb/${creationPolicy.activeOrb.slug}`}>Open active Orb →</Link></div> : null}{creationPolicy?.adminExempt ? <small className="field-help">Admin test wallet: concurrent Orb creation is enabled.</small> : null}</div><div className="field full"><label>X host account</label><XConnect returnTo="/create" requirePublic onChange={setXUser} />{xUser?.protected ? <small className="field-warning">Orb hosts must be public so every player can complete the Follow Host requirement immediately.</small> : null}</div></div>
        </> : null}

        {step === 1 ? <>
          <span className="eyebrow">Step 2 of 6</span><h2>Choose the prize.</h2>
          <p>Pick from standard SPL tokens already in your connected wallet. The winner receives the full advertised prize; the {money(ORBS_FEE_USD)} Orbs fee is added separately in the same token. Minimum launch commitment is {money(MIN_WALLET_REQUIREMENT_USD)} total: {money(MIN_PRIZE_USD)} prize + {money(ORBS_FEE_USD)} fee.</p>
          <div className="fields"><div className="field full"><label>Prize token</label><TokenPicker value={token} onChange={handleTokenChange} /></div>{token ? <><div className="field"><div className="field-label-row"><label>Prize amount · {token.symbol}</label><button type="button" className="input-max" disabled={maxPrizeUsd < MIN_PRIZE_USD} onClick={useMaxPrize}>Max</button></div><input type="number" min="0" step="any" value={prizeInput} onChange={(event) => setPrize(event.target.value)} placeholder={`You have ${amount(token.balance)} ${token.symbol}`} />{maxPrizeUsd >= MIN_PRIZE_USD ? <small className="field-help">Max uses the live wallet balance, reserves the signed {money(ORBS_FEE_USD)} fee quote, and puts the rest into the winner prize.{maxSelected ? " Max selected." : ""}</small> : null}</div><div className="field"><label>Prize value</label><input value={prizeAmount > 0 ? money(prizeUsd) : `${money(MIN_PRIZE_USD)} minimum prize`} readOnly /></div><div className="field full"><div className={`prize-math ${prizeReady ? "ready" : ""}`}><div><span>Winner gets</span><strong>{prizeAmount > 0 ? `${amount(prizeAmount)} ${token.symbol}` : "—"}</strong><small>{prizeAmount > 0 ? money(prizeUsd) : `${money(MIN_PRIZE_USD)} minimum prize`}</small></div><b>+</b><div><span>Orbs fee</span><strong>{amount(feeTokenAmount)} {token.symbol}</strong><small>{money(ORBS_FEE_USD)}</small></div><b>=</b><div><span>Wallet requirement</span><strong>{prizeAmount > 0 ? `${amount(totalTokenAmount)} ${token.symbol}` : "—"}</strong><small>{prizeAmount > 0 ? `${money(totalUsd)} total · balance ${money(token.usdValue || 0)}` : `${money(MIN_WALLET_REQUIREMENT_USD)} minimum total · balance ${money(token.usdValue || 0)}`}</small></div></div>{prizeAmount > 0 && prizeUsd < MIN_PRIZE_USD ? <small className="field-warning">Increase the winner prize to at least {money(MIN_PRIZE_USD)}.</small> : null}{prizeAmount > 0 && !rawCoverageReady ? <small className="field-warning">This prize plus the {money(ORBS_FEE_USD)} fee exceeds the exact token balance at the locked quote. Use Max to fit the wallet exactly.</small> : null}</div></> : null}</div>
        </> : null}

        {step === 2 ? <>
          <span className="eyebrow">Step 3 of 6</span><h2>Design the game.</h2><p>Choose the target solve-time band and your community palette. These settings are frozen into every participant&apos;s canonical game.</p>
          <div className="difficulty">{profiles.map((profile) => <button key={profile.key} className={difficulty === profile.key ? "active" : ""} onClick={() => setDifficulty(profile.key)}><span className="difficulty-tag">{profile.label}</span><strong>{profile.name}</strong><small>{profile.time} target solve</small></button>)}</div>
          <div className="game-style-builder"><div className="game-style-preview" style={{ background: `radial-gradient(circle at 35% 30%, ${style.marbleSecondary}, ${style.marble} 30%, ${style.accent} 66%, ${style.floor})`, borderColor: style.walls }}><div className="style-preview-orb" style={{ background: `radial-gradient(circle at 35% 28%, #fff, ${style.marbleSecondary} 14%, ${style.marble} 44%, ${style.accent} 72%, ${style.floor})` }} /><div className="style-preview-rail" style={{ background: style.walls, boxShadow: `0 0 28px ${style.walls}` }} /><span>LIVE PALETTE</span></div><div><div className="game-presets">{GAME_STYLE_PRESETS.map((preset) => <button key={preset.name} onClick={() => setStyle(preset.style)}>{preset.name}</button>)}</div><div className="fields game-color-grid">{colorField("marble", "Marble core")}{colorField("marbleSecondary", "Marble glow")}{colorField("walls", "Glass rails")}{colorField("floor", "World / floor")}{colorField("accent", "Goal / accent")}</div></div></div>
          <div className="game-preview-row"><Link className="btn-primary" href={previewHref}>Play this style →</Link><span>Deterministic preview · no prize</span></div>
        </> : null}

        {step === 3 ? <>
          <span className="eyebrow">Step 4 of 6</span><h2>Schedule launch.</h2><p>Give the X post time to cook. The exact timestamp becomes immutable when the Anchor funding transaction succeeds.</p>
          {reviewRefreshError ? <div className="form-error">{reviewRefreshError}</div> : null}<div className="fields"><div className="field"><label>Date</label><input type="date" value={launchDate} onChange={(event) => setLaunchDate(event.target.value)} /></div><div className="field"><label>Time · your local timezone</label><input type="time" value={launchTime} onChange={(event) => setLaunchTime(event.target.value)} /></div><div className="field full"><div className="launch-preview"><span>Scheduled start</span><strong>{launchReady ? new Date(launchMs).toLocaleString([], { dateStyle: "full", timeStyle: "short" }) : "Choose a future launch time"}</strong><small>The maze seed and geometry remain sealed until this moment.</small></div></div></div>
        </> : null}

        {step === 4 ? <>
          <span className="eyebrow">Step 5 of 6</span><h2>Review the Orb.</h2><p>Review the exact prize before sealing the competition. The funding transaction below uses these exact reviewed prize and fee parameters.</p>
          <div className="orb-review-grid"><div><span>Host</span><strong>@{xUser?.username || "—"}</strong></div><div><span>Winner prize</span><strong>{token && prizeAmount ? `${amount(prizeAmount)} ${token.symbol}` : "—"}</strong><small>{money(prizeUsd)}</small></div><div><span>Orbs fee</span><strong>{token ? `${amount(feeTokenAmount)} ${token.symbol}` : "—"}</strong><small>{money(ORBS_FEE_USD)}</small></div><div><span>Total wallet debit</span><strong>{token && prizeAmount ? `${amount(totalTokenAmount)} ${token.symbol}` : "—"}</strong><small>{money(totalUsd)}</small></div><div><span>Game</span><strong>{profiles.find((p) => p.key === difficulty)?.label}</strong><small>{profiles.find((p) => p.key === difficulty)?.time}</small></div><div><span>Launch</span><strong>{launchReady ? new Date(launchMs).toLocaleString() : "—"}</strong></div></div>
          <div className="funding-review"><span className="funding-review-kicker">Funding commitment</span><strong>{token && prizeAmount ? `${amount(prizeAmount)} ${token.symbol} (${money(prizeUsd)}) winner prize + ${money(ORBS_FEE_USD)} Orbs fee = ${money(totalUsd)} total wallet debit.` : "Review your prize amount."}</strong><p>Once a funded Orb is launched, you cannot cancel it or withdraw the prize early. The prize remains locked for the competition. If the contract reaches its expiry without a valid winner claim, the protocol refund path returns the refundable prize funds to the host wallet.</p>{maxSelected ? <small className="field-help">Max is locked to the refreshed wallet snapshot shown above, so prize + fee fits the available token balance exactly.</small> : null}<label className="funding-ack"><input type="checkbox" checked={fundingAcknowledged} onChange={(event) => setFundingAcknowledged(event.target.checked)} /><span>I reviewed the prize and total wallet debit and understand a funded Orb cannot be canceled or withdrawn early.</span></label></div>
          <div className="test-orb-note"><strong>On-chain escrow funding</strong><span>Your wallet signs the exact prize debit while the Orbs relayer sponsors SOL/rent. The full advertised prize moves into this Orb&apos;s isolated Anchor vault and the separate protocol fee goes to the fixed treasury ATA.</span></div>
          {reviewRefreshError ? <div className="form-error">{reviewRefreshError}</div> : null}{createError ? <div className="form-error">{createError}</div> : null}<button className="btn-primary" disabled={!identityReady || !prizeReady || !launchReady || !fundingAcknowledged || creating} onClick={() => void createOrb()}>{creating ? "Funding & sealing Orb…" : pendingOrb ? "Retry funding →" : "Fund & seal Orb →"}</button>
        </> : null}

        {step === 5 && createdOrb ? <>
          <span className="eyebrow">Step 6 of 6</span><h2>Your Orb is sealed.</h2><p>Your share card is ready. Post it on X, then take the same waiting-room link to Discord, Telegram and every community you want at the starting line.</p>
          <div className="share-card-preview"><img src={shareCardUrl} alt={`${amount(prizeAmount)} ${token?.symbol || "SPL"} Orb share card`} onLoad={() => { setShareCardReady(true); setShareCardFailed(false); }} onError={() => { setShareCardReady(false); setShareCardFailed(true); }} /><div><strong>{shareCardReady ? "X card ready." : shareCardFailed ? "The X card could not be prepared." : "Preparing the X card…"}</strong><span>{shareCardReady ? "The exact canonical image is now warmed and ready for X to crawl." : shareCardFailed ? "Retry this page before sharing so X does not receive an incomplete link preview." : "The share button unlocks only after the image has loaded successfully."}</span></div></div>
          <div className="sealed-orb"><span>GAME COMMITMENT</span><code>{createdOrb.commitment}</code><small>SHA-256 commitment · seed remains encrypted server-side until launch</small></div>
          <div className="fields"><div className="field full"><label>Waiting-room URL</label><input value={shareUrl} readOnly /></div><div className="share-actions field full"><button className="btn-primary" onClick={async () => { await navigator.clipboard.writeText(shareUrl); setCopied(true); setTimeout(() => setCopied(false), 1200); }}>{copied ? "Copied ✓" : "Copy link"}</button>{shareCardReady ? <a className="btn-secondary" href={`https://x.com/intent/post?${hostShareParams.toString()}`} target="_blank" rel="noreferrer">Post with card on X ↗</a> : <button className="btn-secondary" disabled>{shareCardFailed ? "Card unavailable" : "Preparing X card…"}</button>}<a className="btn-secondary" href={shareCardUrl} download={`orbs-${createdOrb.slug}.jpg`} target="_blank" rel="noreferrer">Download card</a></div></div>
          <p className="share-wide-note">Share it far and wide—the bigger the waiting room, the bigger the live moment.</p>
        </> : null}

        {step < 4 ? <div className="wizard-actions"><button className="btn-ghost" disabled={step === 0} onClick={() => setStep((value) => Math.max(0, value - 1))}>← Back</button><button className="btn-primary" disabled={!canContinue || reviewRefreshing} onClick={() => { if (step === 3) void refreshFundingForReview(); else setStep((value) => Math.min(4, value + 1)); }}>{reviewRefreshing ? "Refreshing funding quote…" : "Continue →"}</button></div> : step === 4 ? <div className="wizard-actions"><button className="btn-ghost" onClick={() => setStep(3)}>← Back</button></div> : null}
      </section>
    </div>
  );
}
