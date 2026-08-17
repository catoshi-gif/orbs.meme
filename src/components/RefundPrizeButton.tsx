"use client";

import { useState } from "react";

export default function RefundPrizeButton({ slug, compact = false, onSuccess }: { slug: string; compact?: boolean; onSuccess?: () => void }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const refund = async () => {
    setBusy(true); setMessage(null);
    try {
      const response = await fetch(`/api/orbs/${encodeURIComponent(slug)}/refund`, { method: "POST" });
      const payload = await response.json() as { ok?: boolean; signature?: string; error?: string };
      if (!response.ok || !payload.ok) throw new Error(payload.error || "Could not refund Orb");
      setMessage(`Prize returned to the host · ${payload.signature?.slice(0, 8)}…`);
      onSuccess?.();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not refund Orb"); }
    finally { setBusy(false); }
  };
  return <div>
    <button className={compact ? "mini-action" : "btn-primary"} disabled={busy} onClick={() => void refund()}>{busy ? "Returning…" : compact ? "Retrieve prize" : "Return expired prize to host"}</button>
    {message ? <p className="muted" style={{marginTop:12}}>{message}</p> : null}
  </div>;
}
