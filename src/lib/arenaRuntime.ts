import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { ARENA_GAME_VERSION } from "@/game/arena";
import type { GameStyle } from "@/game/types";
import type { ArenaEntrantProfile } from "@/lib/arenaEntrants";

export const ARENA_JOIN_SCHEMA = 1 as const;
export const ARENA_RESULT_SCHEMA = 1 as const;

export type ArenaJoinPayload = {
  schemaVersion: typeof ARENA_JOIN_SCHEMA;
  orbId: string;
  slug: string;
  wallet: string;
  xUserId: string;
  username: string;
  profileImageUrl?: string | null;
  followersCount?: number | null;
  orbColor: string;
  orbGlow: string;
  startsAt: number;
  endsAt: number;
  commitment: string;
  style: GameStyle;
  issuedAt: number;
  expiresAt: number;
};

function hmacKey() {
  const key = (process.env.ARENA_RUNTIME_HMAC_KEY || "").trim();
  if (key.length < 32) throw new Error("ARENA_RUNTIME_HMAC_KEY must be at least 32 characters");
  return key;
}

export function arenaRealtimeUrl() {
  const value = (process.env.NEXT_PUBLIC_ARENA_REALTIME_URL || "").trim().replace(/\/$/, "");
  if (!value) throw new Error("NEXT_PUBLIC_ARENA_REALTIME_URL is not configured");
  const url = new URL(value);
  if (!/^wss?:$/.test(url.protocol)) throw new Error("NEXT_PUBLIC_ARENA_REALTIME_URL must be ws:// or wss://");
  return url.toString().replace(/\/$/, "");
}

export function arenaRuntimeConfigured() {
  try {
    return Boolean(arenaRealtimeUrl()) && (process.env.ARENA_RUNTIME_HMAC_KEY || "").trim().length >= 32;
  } catch { return false; }
}


function arenaHealthUrl() {
  const ws = new URL(arenaRealtimeUrl());
  ws.protocol = ws.protocol === "wss:" ? "https:" : "http:";
  ws.pathname = "/health";
  ws.search = "";
  ws.hash = "";
  return ws.toString();
}

export async function arenaRuntimeHealthy(timeoutMs = 2500) {
  if (!arenaRuntimeConfigured()) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(arenaHealthUrl(), {
      method: "GET",
      cache: "no-store",
      signal: controller.signal,
      headers: { "accept": "application/json" },
    });
    if (!response.ok) return false;
    const payload = await response.json().catch(() => null) as { ok?: unknown; version?: unknown } | null;
    return payload?.ok === true && payload.version === ARENA_GAME_VERSION;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function sign(encoded: string) {
  return createHmac("sha256", hmacKey()).update(encoded, "utf8").digest("base64url");
}

export function issueArenaJoinToken(input: {
  orbId: string;
  slug: string;
  profile: ArenaEntrantProfile;
  startsAt: number;
  endsAt: number;
  commitment: string;
  style: GameStyle;
}) {
  const now = Date.now();
  const payload: ArenaJoinPayload = {
    schemaVersion: ARENA_JOIN_SCHEMA,
    orbId: input.orbId,
    slug: input.slug,
    wallet: input.profile.wallet,
    xUserId: input.profile.xUserId,
    username: input.profile.username,
    profileImageUrl: input.profile.profileImageUrl || null,
    followersCount: Number.isFinite(input.profile.followersCount) ? Number(input.profile.followersCount) : null,
    orbColor: input.profile.orbColor,
    orbGlow: input.profile.orbGlow,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    commitment: input.commitment,
    style: input.style,
    issuedAt: now,
    expiresAt: Math.min(input.endsAt, now + 1000 * 60 * 60 * 6),
  };
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return { token: `${encoded}.${sign(encoded)}`, payload };
}

function arenaHttpUrl(pathname: string) {
  const ws = new URL(arenaRealtimeUrl());
  ws.protocol = ws.protocol === "wss:" ? "https:" : "http:";
  ws.pathname = pathname;
  ws.search = "";
  ws.hash = "";
  return ws.toString();
}

export async function sendArenaIntegrityControl(input: { action: "ban" | "unban"; wallet?: string | null; xUserId?: string | null }) {
  if (!arenaRuntimeConfigured()) return { ok: false, kicked: 0 };
  const body = JSON.stringify({ schemaVersion: 1, ...input });
  const timestamp = String(Date.now());
  const signature = createHmac("sha256", hmacKey()).update(`${timestamp}.${body}`, "utf8").digest("base64url");
  try {
    const response = await fetch(arenaHttpUrl("/admin/control"), {
      method: "POST",
      headers: { "content-type": "application/json", "x-arena-timestamp": timestamp, "x-arena-signature": signature },
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(3500),
    });
    const payload = await response.json().catch(() => null) as { ok?: boolean; kicked?: number } | null;
    return { ok: response.ok && payload?.ok === true, kicked: Number(payload?.kicked || 0) };
  } catch { return { ok: false, kicked: 0 }; }
}

export function verifyArenaRuntimeRequest(rawBody: string, timestamp: string | null, supplied: string | null) {
  if (!timestamp || !supplied) return false;
  const stamp = Number(timestamp);
  if (!Number.isFinite(stamp) || Math.abs(Date.now() - stamp) > 120_000) return false;
  const expected = createHmac("sha256", hmacKey()).update(`${timestamp}.${rawBody}`, "utf8").digest("base64url");
  const a = Buffer.from(expected, "utf8"), b = Buffer.from(supplied, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}
