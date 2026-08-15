"use client";

import { useCallback, useEffect, useState } from "react";

export type XUser = {
  id: string;
  username: string;
  name: string;
  profileImageUrl?: string;
  protected: boolean;
};

type Props = {
  returnTo?: string;
  compact?: boolean;
  requirePublic?: boolean;
  minimalConnected?: boolean;
  onChange?: (user: XUser | null) => void;
};

export default function XConnect({ returnTo, compact = false, requirePublic = false, minimalConnected = false, onChange }: Props) {
  const [loading, setLoading] = useState(true);
  const [configured, setConfigured] = useState(true);
  const [user, setUser] = useState<XUser | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/x/session", { cache: "no-store" });
      const payload = await response.json() as { configured?: boolean; connected?: boolean; user?: XUser | null };
      setConfigured(payload.configured !== false);
      const next = payload.connected ? payload.user || null : null;
      setUser(next);
      onChange?.(next);
    } catch {
      setUser(null);
      onChange?.(null);
    } finally {
      setLoading(false);
    }
  }, [onChange]);

  useEffect(() => { void load(); }, [load]);

  const connect = () => {
    const destination = returnTo || `${window.location.pathname}${window.location.search}`;
    window.location.href = `/api/x/connect?returnTo=${encodeURIComponent(destination)}`;
  };

  const disconnect = async () => {
    await fetch("/api/x/session", { method: "DELETE" }).catch(() => null);
    setUser(null);
    onChange?.(null);
  };

  if (loading) return <div className={`x-connect-skeleton ${compact ? "compact" : ""}`}>Checking X…</div>;
  if (!configured) return <div className="x-config-note">X connection is ready in code. Add the X OAuth environment variables to enable it.</div>;
  if (!user) return <button className={`btn-x ${compact ? "btn-small" : ""}`} onClick={connect}><span className="x-mark">𝕏</span> Connect X</button>;

  if (minimalConnected) {
    return <button type="button" className="x-disconnect compact x-switch-only" onClick={disconnect}>Switch X</button>;
  }

  return (
    <div className={`x-identity ${compact ? "compact" : ""}`}>
      {user.profileImageUrl ? <img src={user.profileImageUrl} alt="" referrerPolicy="no-referrer" /> : <span className="x-avatar-fallback">𝕏</span>}
      <div><strong>@{user.username}</strong><small>{user.protected ? "Protected account" : "Connected · public account"}</small></div>
      {requirePublic && user.protected ? <span className="x-private-warning">Host must be public</span> : <span className="x-connected-check">✓</span>}
      <button className={`x-disconnect ${compact ? "compact" : ""}`} onClick={disconnect}>{compact ? "Switch X" : "Disconnect"}</button>
    </div>
  );
}
