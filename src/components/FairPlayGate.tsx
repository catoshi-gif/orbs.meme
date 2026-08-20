"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

export default function FairPlayGate({
  slug,
  wallet,
  xUserId,
  enabled,
  onChange,
}: {
  slug: string;
  wallet: string;
  xUserId: string;
  enabled: boolean;
  onChange: (accepted: boolean) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [open, setOpen] = useState(false);
  const [checked, setChecked] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setAccepted(false);
    setChecked(false);
    setOpen(false);
    setError(null);
    onChange(false);
    if (!enabled || !wallet) return () => { active = false; };
    setLoading(true);
    fetch(`/api/fair-play?wallet=${encodeURIComponent(wallet)}`, { cache: "no-store" })
      .then((response) => response.json())
      .then((payload: { accepted?: boolean }) => {
        if (!active) return;
        const next = Boolean(payload.accepted);
        setAccepted(next);
        onChange(next);
        if (!next) setOpen(true);
      })
      .catch(() => { if (active) onChange(false); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [enabled, onChange, wallet, xUserId]);

  const agree = async () => {
    if (!checked || saving) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/fair-play", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, wallet, accepted: true }),
      });
      const payload = await response.json() as { accepted?: boolean; error?: string };
      if (!response.ok || !payload.accepted) throw new Error(payload.error || "Fair Play acceptance could not be saved");
      setAccepted(true);
      setOpen(false);
      onChange(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Fair Play acceptance failed");
    } finally {
      setSaving(false);
    }
  };

  if (!enabled) return null;
  if (loading) return <small>Checking Fair Play agreement…</small>;
  if (accepted) return null;

  return <>
    <button type="button" className="mini-action" onClick={() => setOpen(true)}>Review &amp; agree</button>
    {open ? <div className="fair-play-backdrop" role="presentation">
      <section className="fair-play-modal" role="dialog" aria-modal="true" aria-labelledby="fair-play-title">
        <span className="eyebrow">Fair play</span>
        <h2 id="fair-play-title">Human play only.</h2>
        <p>Orbs competitions require direct human gameplay. Bots, AI agents, scripts, macros, automated controls, and other automated or materially assisted gameplay are prohibited.</p>
        <p>To protect competition integrity, Orbs may evaluate gameplay behavior and associated account, wallet, session, and network signals. Suspected violations may result in live-game removal, disqualification, temporary restriction, or permanent blocking of associated X accounts and wallets.</p>
        <label className="fair-play-check">
          <input type="checkbox" checked={checked} onChange={(event) => setChecked(event.target.checked)} />
          <span>I understand and agree to the <Link href="/fair-play" target="_blank">Fair Play Policy</Link> and <Link href="/terms" target="_blank">Terms of Use</Link>.</span>
        </label>
        {error ? <small className="q-error">{error}</small> : null}
        <button type="button" className="btn-primary fair-play-agree" onClick={() => void agree()} disabled={!checked || saving}>{saving ? "Saving…" : "Agree & continue"}</button>
        <small className="fair-play-note">You only need to accept the current policy once for this X account and wallet.</small>
      </section>
    </div> : null}
  </>;
}
