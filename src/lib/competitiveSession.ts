import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { GameManifest } from "@/game/types";

export type CompetitiveSession = {
  schemaVersion: 1;
  orbId: string;
  slug: string;
  wallet: string;
  xUserHash: string;
  manifestHash: string;
  issuedAt: number;
  expiresAt: number;
};

function signingSecret() {
  const value = (process.env.ORBS_SESSION_SIGNING_KEY || "").trim();
  if (value.length < 24) throw new Error("ORBS_SESSION_SIGNING_KEY must be a long random secret");
  return value;
}

export function competitiveSessionsConfigured() {
  return (process.env.ORBS_SESSION_SIGNING_KEY || "").trim().length >= 24;
}

export function hashXUserId(xUserId: string) {
  return createHash("sha256").update(`orbs:x-user:v1:${xUserId}`, "utf8").digest("hex");
}

function encodePayload(payload: CompetitiveSession) {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function signatureFor(encodedPayload: string) {
  return createHmac("sha256", signingSecret()).update(encodedPayload, "utf8").digest("base64url");
}

export function issueCompetitiveSession(input: {
  orbId: string;
  slug: string;
  wallet: string;
  xUserId: string;
  manifestHash: string;
  expiresAt?: number;
}) {
  const now = Date.now();
  const payload: CompetitiveSession = {
    schemaVersion: 1,
    orbId: input.orbId,
    slug: input.slug,
    wallet: input.wallet,
    xUserHash: hashXUserId(input.xUserId),
    manifestHash: input.manifestHash,
    issuedAt: now,
    expiresAt: input.expiresAt ?? now + 1000 * 60 * 60 * 6,
  };
  const encoded = encodePayload(payload);
  return { token: `${encoded}.${signatureFor(encoded)}`, payload };
}

export function verifyCompetitiveSession(token: string): CompetitiveSession | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [encoded, supplied] = parts;
  if (!encoded || !supplied) return null;
  const expected = signatureFor(encoded);
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(supplied, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  let payload: CompetitiveSession;
  try { payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as CompetitiveSession; } catch { return null; }
  if (payload.schemaVersion !== 1 || !payload.orbId || !payload.slug || !payload.wallet || !payload.manifestHash || !payload.xUserHash) return null;
  if (!Number.isFinite(payload.issuedAt) || !Number.isFinite(payload.expiresAt) || payload.expiresAt <= Date.now()) return null;
  return payload;
}

export function sessionMatchesManifest(session: CompetitiveSession, manifest: GameManifest, manifestHash: string) {
  return session.slug === manifest.slug && session.manifestHash === manifestHash;
}
