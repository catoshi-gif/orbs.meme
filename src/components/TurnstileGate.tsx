"use client";

import Script from "next/script";
import { useCallback, useEffect, useRef, useState } from "react";

 declare global {
  interface Window {
    turnstile?: {
      render: (container: HTMLElement, options: Record<string, unknown>) => string;
      reset: (widgetId?: string) => void;
      remove: (widgetId: string) => void;
    };
  }
}

type Props = {
  slug: string;
  wallet: string;
  enabled: boolean;
  onVerified: (verified: boolean) => void;
};

export default function TurnstileGate({ slug, wallet, enabled, onVerified }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const [scriptReady, setScriptReady] = useState(false);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [verified, setVerified] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || "";

  useEffect(() => {
    if (!enabled || !wallet) { setConfigured(null); setVerified(false); onVerified(false); return; }
    fetch(`/api/orbs/${encodeURIComponent(slug)}/qualify/human?wallet=${encodeURIComponent(wallet)}`, { cache: "no-store" })
      .then((response) => response.json())
      .then((payload: { configured?: boolean; verified?: boolean }) => {
        setConfigured(Boolean(payload.configured));
        setVerified(Boolean(payload.verified));
        onVerified(Boolean(payload.verified));
      })
      .catch(() => { setConfigured(Boolean(siteKey)); onVerified(false); });
  }, [enabled, onVerified, siteKey, slug, wallet]);

  const submitToken = useCallback(async (token: string) => {
    setSubmitting(true); setError(null);
    try {
      const response = await fetch(`/api/orbs/${encodeURIComponent(slug)}/qualify/human`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet, token }),
      });
      const payload = await response.json() as { verified?: boolean; error?: string };
      if (!response.ok || !payload.verified) throw new Error(payload.error || "Human check failed");
      setVerified(true);
      onVerified(true);
    } catch (cause) {
      onVerified(false);
      setError(cause instanceof Error ? cause.message : "Human check failed");
      if (widgetIdRef.current) window.turnstile?.reset(widgetIdRef.current);
    } finally { setSubmitting(false); }
  }, [onVerified, slug, wallet]);

  useEffect(() => {
    if (!enabled || verified || !scriptReady || !siteKey || !containerRef.current || !window.turnstile || widgetIdRef.current) return;
    const id = window.turnstile.render(containerRef.current, {
      sitekey: siteKey,
      action: "orb-qualify",
      theme: "auto",
      size: containerRef.current.clientWidth < 300 ? "compact" : "flexible",
      callback: (token: string) => void submitToken(token),
      "expired-callback": () => onVerified(false),
      "error-callback": () => { onVerified(false); setError("Human check could not load. Please retry."); },
    });
    widgetIdRef.current = id;
    return () => {
      if (widgetIdRef.current) window.turnstile?.remove(widgetIdRef.current);
      widgetIdRef.current = null;
    };
  }, [enabled, onVerified, scriptReady, siteKey, submitToken, verified]);

  if (!enabled) return <small>Complete X, follow, and wallet verification first.</small>;
  if (configured === false || !siteKey) return <small className="q-error">Turnstile is not configured yet. Add the Cloudflare keys to enable competitive entry.</small>;
  if (verified) return <small className="human-proof-saved">✓ Human proof saved for this Orb</small>;

  return <div className="turnstile-gate">
    <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" strategy="afterInteractive" onLoad={() => setScriptReady(true)} />
    <div ref={containerRef} className="turnstile-widget" />
    {submitting ? <small>Confirming human check…</small> : null}
    {error ? <small className="q-error">{error}</small> : null}
  </div>;
}
