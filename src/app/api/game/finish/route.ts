import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { DEFAULT_GAME_STYLE } from "@/game/constants";
import { hashCanonicalManifest, hashCanonicalReplay } from "@/game/canonical";
import { generateGameManifest, normalizeDifficulty } from "@/game/maze";
import { safeColor } from "@/game/theme";
import type { GameStyle, ReplayEnvelope } from "@/game/types";
import { verifyReplay } from "@/game/verifier";
import { getOrbRecord, getCanonicalOrbManifest } from "@/lib/orbStore";
import { hashXUserId, sessionMatchesManifest, verifyCompetitiveSession } from "@/lib/competitiveSession";
import { hasFollowProof, hasShareProof, hasWalletProof } from "@/lib/qualification";
import { hasHumanProof } from "@/lib/turnstile";
import { getCurrentXSession } from "@/lib/xAuth";
import { getWinner, tryAcquireWinner, type WinnerRecord } from "@/lib/upstashWinner";
import { orbEndsAt } from "@/lib/orbLifecycle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

function publicWinner(winner: WinnerRecord | null) {
  if (!winner) return null;
  const { xUserId: _privateXId, ...safe } = winner;
  return safe;
}

type FinishBody = {
  slug?: unknown;
  difficulty?: unknown;
  style?: Partial<Record<keyof GameStyle, unknown>>;
  replay?: unknown;
  wallet?: unknown;
  competitiveSession?: unknown;
};

function cleanSlug(value: unknown) {
  if (typeof value !== "string") return null;
  const slug = value.trim();
  if (!slug || slug.length > 96 || !/^[a-zA-Z0-9_-]+$/.test(slug)) return null;
  return slug;
}

function cleanStyle(value: FinishBody["style"]): GameStyle {
  return {
    marble: safeColor(typeof value?.marble === "string" ? value.marble : undefined, DEFAULT_GAME_STYLE.marble),
    marbleSecondary: safeColor(typeof value?.marbleSecondary === "string" ? value.marbleSecondary : undefined, DEFAULT_GAME_STYLE.marbleSecondary),
    walls: safeColor(typeof value?.walls === "string" ? value.walls : undefined, DEFAULT_GAME_STYLE.walls),
    floor: safeColor(typeof value?.floor === "string" ? value.floor : undefined, DEFAULT_GAME_STYLE.floor),
    accent: safeColor(typeof value?.accent === "string" ? value.accent : undefined, DEFAULT_GAME_STYLE.accent),
  };
}

function cleanWallet(value: unknown) {
  if (typeof value !== "string") return null;
  try { return new PublicKey(value).toBase58(); } catch { return null; }
}

export async function POST(request: Request) {
  const contentLength = Number(request.headers.get("content-length") || "0");
  if (Number.isFinite(contentLength) && contentLength > 3_000_000) {
    return NextResponse.json({ ok: false, error: "Replay payload is too large" }, { status: 413 });
  }

  let body: FinishBody;
  try { body = await request.json() as FinishBody; }
  catch { return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 }); }

  const slug = cleanSlug(body.slug);
  if (!slug) return NextResponse.json({ ok: false, error: "Invalid Orb slug" }, { status: 400 });
  const replay = body.replay as ReplayEnvelope | undefined;
  if (!replay || typeof replay !== "object") return NextResponse.json({ ok: false, error: "Missing replay" }, { status: 400 });

  const realOrb = await getOrbRecord(slug);
  let manifest;
  let manifestHash: string;
  let lockId = slug;
  let wallet: string | undefined;
  let xUserId: string | undefined;
  let xUsername: string | undefined;

  if (realOrb) {
    const existing = await getWinner(realOrb.id);
    if (existing) return NextResponse.json({ ok: true, verified: false, firstWinner: false, winnerStore: "upstash", winner: publicWinner(existing), error: "A verified winner has already cleared this Orb." }, { status: 409 });
    if (Date.now() >= orbEndsAt(realOrb)) return NextResponse.json({ ok: false, verified: false, error: "This Orb has expired." }, { status: 409 });
    const [x, canonical] = await Promise.all([getCurrentXSession(), getCanonicalOrbManifest(slug)]);
    if (!x) return NextResponse.json({ ok: false, error: "Your X session expired. Reconnect X from the Orb lobby." }, { status: 401 });
    wallet = cleanWallet(body.wallet) || undefined;
    const sessionToken = typeof body.competitiveSession === "string" ? body.competitiveSession : "";
    const session = sessionToken ? verifyCompetitiveSession(sessionToken) : null;
    if (!wallet || !session) return NextResponse.json({ ok: false, error: "Missing or invalid competitive session" }, { status: 401 });
    if (session.orbId !== realOrb.id || session.slug !== slug || session.wallet !== wallet || session.xUserHash !== hashXUserId(x.user.id)) {
      return NextResponse.json({ ok: false, error: "Competitive session identity mismatch" }, { status: 403 });
    }
    if (!sessionMatchesManifest(session, canonical.manifest, canonical.manifestHash)) {
      return NextResponse.json({ ok: false, error: "Competitive session is not bound to this game manifest" }, { status: 403 });
    }

    const [followed, walletVerified, humanVerified, shared] = await Promise.all([
      hasFollowProof(x.user.id, realOrb.hostX.id),
      hasWalletProof(slug, x.user.id, wallet),
      hasHumanProof(slug, x.user.id, wallet),
      hasShareProof(slug, x.user.id, wallet),
    ]);
    if (!followed || !walletVerified || !humanVerified || !shared) return NextResponse.json({ ok: false, error: "Competition qualification is no longer valid" }, { status: 403 });

    lockId = realOrb.id;
    manifest = canonical.manifest;
    manifestHash = canonical.manifestHash;
    xUserId = x.user.id;
    xUsername = x.user.username;
  } else {
    // Public demo path intentionally remains self-contained and non-financial.
    const difficulty = normalizeDifficulty(typeof body.difficulty === "string" ? body.difficulty : undefined);
    const style = cleanStyle(body.style);
    manifest = generateGameManifest(slug, difficulty, style);
    manifestHash = await hashCanonicalManifest(manifest);
  }

  const verification = await verifyReplay(manifest, replay);
  if (!verification.verified || verification.finishTick === undefined || verification.verifiedElapsedMs === undefined) {
    return NextResponse.json({ ok: true, verified: false, error: verification.reason || "Replay rejected" }, { status: 422 });
  }

  const replayHash = await hashCanonicalReplay(replay);
  const record = {
    slug,
    orbId: realOrb?.id,
    replayId: replay.replayId,
    manifestHash,
    replayHash,
    verifiedElapsedMs: verification.verifiedElapsedMs,
    verifiedAt: new Date().toISOString(),
    wallet,
    xUserId,
    xUsername,
  };
  const winner = await tryAcquireWinner(lockId, record);
  return NextResponse.json({
    ok: true,
    verified: true,
    firstWinner: winner.acquired,
    winnerStore: winner.configured ? "upstash" : "verification-only",
    winner: publicWinner(winner.record),
    verification: {
      finishTick: verification.finishTick,
      elapsedMs: verification.verifiedElapsedMs,
      checkpoints: verification.checkpoints,
      resets: verification.resets,
      manifestHash,
      replayHash,
    },
  });
}
