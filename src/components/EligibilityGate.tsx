"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";

function base64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export default function EligibilityGate({
  compact = false,
  onChange,
}: {
  compact?: boolean;
  onChange?: (confirmed: boolean) => void;
}) {
  const { publicKey, signMessage } = useWallet();
  const wallet = publicKey?.toBase58() || "";
  const [confirmed, setConfirmed] = useState(false);
  const [birthDate, setBirthDate] = useState("");
  const [checking, setChecking] = useState(false);
  const [loading, setLoading] = useState(Boolean(wallet));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setConfirmed(false);
    setBirthDate("");
    setError(null);
    if (!wallet) {
      setLoading(false);
      onChange?.(false);
      return;
    }
    setLoading(true);
    fetch(`/api/eligibility/status?wallet=${encodeURIComponent(wallet)}`, { cache: "no-store" })
      .then((response) => response.json())
      .then((payload: { confirmed?: boolean }) => {
        if (!active) return;
        const next = Boolean(payload.confirmed);
        setConfirmed(next);
        onChange?.(next);
      })
      .catch(() => { if (active) onChange?.(false); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [wallet, onChange]);

  const verify = async () => {
    if (!wallet || !signMessage) {
      setError("This wallet must support message signing.");
      return;
    }
    if (!birthDate) {
      setError("Enter your date of birth.");
      return;
    }
    setChecking(true);
    setError(null);
    try {
      const challengeResponse = await fetch("/api/eligibility/challenge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet }),
      });
      const challenge = await challengeResponse.json() as { ok?: boolean; alreadyConfirmed?: boolean; message?: string; error?: string };
      if (!challengeResponse.ok || !challenge.ok) throw new Error(challenge.error || "Could not start eligibility verification");
      if (challenge.alreadyConfirmed) {
        setConfirmed(true);
        onChange?.(true);
        return;
      }
      if (!challenge.message) throw new Error("Eligibility challenge was incomplete");
      const signature = await signMessage(new TextEncoder().encode(challenge.message));
      const verifyResponse = await fetch("/api/eligibility/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet, birthDate, signature: base64(signature) }),
      });
      const result = await verifyResponse.json() as { ok?: boolean; eligible?: boolean; error?: string };
      if (!verifyResponse.ok || !result.ok || !result.eligible) throw new Error(result.error || "Eligibility could not be confirmed");
      setConfirmed(true);
      setBirthDate("");
      onChange?.(true);
    } catch (cause) {
      setConfirmed(false);
      onChange?.(false);
      setError(cause instanceof Error ? cause.message : "Eligibility verification failed");
    } finally {
      setChecking(false);
    }
  };

  if (!wallet) return null;
  if (loading) return <div className={`eligibility-gate ${compact ? "compact" : ""}`}><small>Checking eligibility receipt…</small></div>;
  if (confirmed) return <div className={`eligibility-gate confirmed ${compact ? "compact" : ""}`}><strong>18+ eligibility confirmed ✓</strong><small>Saved for this wallet under the current Rules and Terms.</small></div>;

  return <div className={`eligibility-gate ${compact ? "compact" : ""}`}>
    <div className="eligibility-heading"><strong>Confirm your age once</strong><small>Enter your date of birth to confirm eligibility. We check your age, then discard the date itself.</small></div>
    <div className="eligibility-controls">
      <label className="eligibility-date"><span>Date of birth</span><input type="date" value={birthDate} onChange={(event) => setBirthDate(event.target.value)} aria-label="Date of birth" /></label>
      <button type="button" className="mini-action eligibility-submit" onClick={() => void verify()} disabled={checking || !birthDate}>{checking ? "Confirming…" : "Confirm eligibility"}</button>
    </div>
    <small className="eligibility-legal">By continuing, you confirm the information is accurate and agree to the current <Link href="/rules">Official Rules</Link>, <Link href="/terms">Terms</Link>, and <Link href="/privacy">Privacy Notice</Link>.</small>
    {error ? <small className="q-error">{error}</small> : null}
  </div>;
}
