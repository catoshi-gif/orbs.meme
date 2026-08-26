"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useWallet } from "@solana/wallet-adapter-react";

type Counts = { total: number; registered: number; unregistered: number };
type QualificationDetail = { slug?: string; qualified?: boolean; wallet?: string };
type ChatMessage = { id: string; username: string; profileImageUrl?: string; text: string; sentAt: number };

const EMPTY: Counts = { total: 0, registered: 0, unregistered: 0 };

function relativeTime(sentAt: number) {
  const seconds = Math.max(0, Math.floor((Date.now() - sentAt) / 1000));
  if (seconds < 60) return "now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h`;
}

export default function WaitingRoomPresence({ slug, gameType = "maze", details }: { slug: string; gameType?: "maze" | "arena" | "race"; details?: ReactNode }) {
  const { publicKey } = useWallet();
  const [counts, setCounts] = useState<Counts>(EMPTY);
  const [available, setAvailable] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [canChat, setCanChat] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [clock, setClock] = useState(Date.now());
  const wallet = publicKey?.toBase58() || "";

  const heartbeat = useCallback(async (leave = false) => {
    try {
      const response = await fetch(`/api/orbs/${encodeURIComponent(slug)}/presence`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet: wallet || undefined, leave }),
        cache: "no-store",
        keepalive: leave,
      });
      const payload = await response.json() as { available?: boolean; total?: number; registered?: number; unregistered?: number; messages?: ChatMessage[]; canChat?: boolean };
      if (!response.ok || payload.available === false) return;
      setAvailable(true);
      setCounts({
        total: Number(payload.total || 0),
        registered: Number(payload.registered || 0),
        unregistered: Number(payload.unregistered || 0),
      });
      if (Array.isArray(payload.messages)) setMessages(payload.messages);
      setCanChat(Boolean(payload.canChat));
    } catch {
      // Presence/chat is social ambience. It must never block entry.
    }
  }, [slug, wallet]);

  useEffect(() => {
    const onQualification = (event: Event) => {
      const detail = (event as CustomEvent<QualificationDetail>).detail || {};
      if (detail.slug === slug) void heartbeat();
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

  useEffect(() => {
    if (cooldownUntil <= Date.now()) return;
    const timer = window.setInterval(() => {
      const next = Date.now();
      setClock(next);
      if (next >= cooldownUntil) window.clearInterval(timer);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [cooldownUntil]);

  const cooldown = Math.max(0, Math.ceil((cooldownUntil - clock) / 1000));
  const sendDisabled = sending || !canChat || cooldown > 0 || !draft.trim();
  const chatHint = useMemo(() => {
    if (!wallet) return "Connect and register to join the chat.";
    if (!canChat) return "Finish registration to join the chat.";
    if (cooldown > 0) return `You can send again in ${cooldown}s.`;
    return "Public chat. Registered players can send one message every 30 seconds.";
  }, [wallet, canChat, cooldown]);

  const send = async () => {
    const text = draft.trim();
    if (!text || sendDisabled) return;
    setSending(true); setChatError(null);
    try {
      const response = await fetch(`/api/orbs/${encodeURIComponent(slug)}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet, text }),
      });
      const payload = await response.json() as { messages?: ChatMessage[]; cooldownSeconds?: number; retryAfter?: number; error?: string };
      if (!response.ok) {
        if (response.status === 429) setCooldownUntil(Date.now() + Math.max(1, Number(payload.retryAfter || 30)) * 1000);
        throw new Error(payload.error || "Could not send message");
      }
      setDraft("");
      if (Array.isArray(payload.messages)) setMessages(payload.messages);
      setCooldownUntil(Date.now() + Math.max(1, Number(payload.cooldownSeconds || 30)) * 1000);
      setClock(Date.now());
    } catch (error) {
      setChatError(error instanceof Error ? error.message : "Could not send message");
    } finally { setSending(false); }
  };

  if (!available) return null;
  return <div className="waiting-social">
    <div className="waiting-presence" aria-label={`${counts.total} people currently in the waiting room`}>
      <div className="waiting-presence-live"><span className="waiting-presence-dot"/><strong>{counts.total}</strong><span>in the waiting room</span></div>
      <div className="waiting-presence-split"><span><b>{counts.registered}</b> registered</span><span><b>{counts.unregistered}</b> watching</span></div>
      <small>Registration is required to enter the live {gameType === "arena" ? "Arena" : gameType === "race" ? "Race" : "Maze"}.</small>
    </div>
    {details ? <div className="waiting-room-priority">{details}</div> : null}
    <div className="waiting-chat">
      <div className="waiting-chat-head"><div><span>WAITING ROOM CHAT</span><strong>Talk a little trash.</strong></div><small>{messages.length ? `${messages.length} recent` : "quiet for now"}</small></div>
      <div className={`waiting-chat-feed ${messages.length ? "" : "empty"}`}>
        {messages.length ? messages.map((message) => <div className="waiting-chat-message" key={message.id}>
          {message.profileImageUrl ? <img src={message.profileImageUrl} alt="" referrerPolicy="no-referrer" /> : <span className="waiting-chat-avatar">𝕏</span>}
          <div><div className="waiting-chat-meta"><strong>@{message.username}</strong><span>{relativeTime(message.sentAt)}</span></div><p>{message.text}</p></div>
        </div>) : <p>No messages yet. Registered players can start the room.</p>}
      </div>
      <div className="waiting-chat-compose">
        <input value={draft} onChange={(event) => setDraft(event.target.value.slice(0, 180))} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } }} placeholder={canChat ? "Say something…" : "Register to chat"} disabled={!canChat || sending} maxLength={180} aria-label="Waiting room chat message" />
        <button className="mini-action" onClick={() => void send()} disabled={sendDisabled}>{sending ? "Sending…" : cooldown > 0 ? `${cooldown}s` : "Send"}</button>
      </div>
      <small className={chatError ? "q-error" : "waiting-chat-hint"}>{chatError || chatHint}</small>
    </div>
  </div>;
}
