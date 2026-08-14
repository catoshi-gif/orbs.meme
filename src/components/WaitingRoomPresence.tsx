"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Counts = { total: number; registered: number; unregistered: number };
type QualificationDetail = { slug?: string; qualified?: boolean; wallet?: string };

const EMPTY: Counts = { total: 0, registered: 0, unregistered: 0 };

export default function WaitingRoomPresence({ slug }: { slug: string }) {
  const [counts, setCounts] = useState<Counts>(EMPTY);
  const [available, setAvailable] = useState(false);
  const registration = useRef<{ qualified: boolean; wallet: string }>({ qualified: false, wallet: "" });

  const heartbeat = useCallback(async (leave = false) => {
    try {
      const response = await fetch(`/api/orbs/${encodeURIComponent(slug)}/presence`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          wallet: registration.current.qualified ? registration.current.wallet : undefined,
          leave,
        }),
        cache: "no-store",
        keepalive: leave,
      });
      const payload = await response.json() as { available?: boolean; total?: number; registered?: number; unregistered?: number };
      if (!response.ok || payload.available === false) return;
      setAvailable(true);
      setCounts({
        total: Number(payload.total || 0),
        registered: Number(payload.registered || 0),
        unregistered: Number(payload.unregistered || 0),
      });
    } catch {
      // Presence is decorative/operational telemetry. It must never block entry.
    }
  }, [slug]);

  useEffect(() => {
    const onQualification = (event: Event) => {
      const detail = (event as CustomEvent<QualificationDetail>).detail || {};
      if (detail.slug !== slug) return;
      registration.current = {
        qualified: Boolean(detail.qualified),
        wallet: typeof detail.wallet === "string" ? detail.wallet : "",
      };
      void heartbeat();
    };
    window.addEventListener("orbs:qualification-state", onQualification as EventListener);
    void heartbeat();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void heartbeat();
    }, 30_000);
    const onVisibility = () => { if (document.visibilityState === "visible") void heartbeat(); };
    const onPageHide = () => { void heartbeat(true); };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("orbs:qualification-state", onQualification as EventListener);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [heartbeat, slug]);

  if (!available) return null;
  return <div className="waiting-presence" aria-label={`${counts.total} people currently in the waiting room`}>
    <div className="waiting-presence-live"><span className="waiting-presence-dot"/><strong>{counts.total}</strong><span>in the waiting room</span></div>
    <div className="waiting-presence-split"><span><b>{counts.registered}</b> registered</span><span><b>{counts.unregistered}</b> watching</span></div>
    <small>Registration is required to enter the live maze.</small>
  </div>;
}
