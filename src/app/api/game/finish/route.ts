import { NextResponse } from "next/server";
import { DEFAULT_GAME_STYLE } from "@/game/constants";
import { hashCanonicalManifest, hashCanonicalReplay } from "@/game/canonical";
import { generateGameManifest, normalizeDifficulty } from "@/game/maze";
import { safeColor } from "@/game/theme";
import type { GameStyle, ReplayEnvelope } from "@/game/types";
import { verifyReplay } from "@/game/verifier";
import { tryAcquireWinner } from "@/lib/upstashWinner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

type FinishBody = {
  slug?: unknown;
  difficulty?: unknown;
  style?: Partial<Record<keyof GameStyle, unknown>>;
  replay?: unknown;
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

export async function POST(request: Request) {
  const contentLength = Number(request.headers.get("content-length") || "0");
  if (Number.isFinite(contentLength) && contentLength > 3_000_000) {
    return NextResponse.json({ ok: false, error: "Replay payload is too large" }, { status: 413 });
  }

  let body: FinishBody;
  try {
    body = await request.json() as FinishBody;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const slug = cleanSlug(body.slug);
  if (!slug) return NextResponse.json({ ok: false, error: "Invalid Orb slug" }, { status: 400 });
  const difficulty = normalizeDifficulty(typeof body.difficulty === "string" ? body.difficulty : undefined);
  const style = cleanStyle(body.style);
  const replay = body.replay as ReplayEnvelope | undefined;
  if (!replay || typeof replay !== "object") {
    return NextResponse.json({ ok: false, error: "Missing replay" }, { status: 400 });
  }

  // V0.4 demo path: regenerate the same deterministic local manifest on the server. Funded Orbs
  // will replace this lookup with the persisted canonical manifest revealed only at starts_at;
  // the verifier below will remain unchanged.
  const manifest = generateGameManifest(slug, difficulty, style);
  const verification = await verifyReplay(manifest, replay);
  if (!verification.verified || verification.finishTick === undefined || verification.verifiedElapsedMs === undefined) {
    return NextResponse.json({
      ok: true,
      verified: false,
      error: verification.reason || "Replay rejected",
    }, { status: 422 });
  }

  const [manifestHash, replayHash] = await Promise.all([
    hashCanonicalManifest(manifest),
    hashCanonicalReplay(replay),
  ]);
  const record = {
    slug,
    replayId: replay.replayId,
    manifestHash,
    replayHash,
    verifiedElapsedMs: verification.verifiedElapsedMs,
    verifiedAt: new Date().toISOString(),
  };
  const winner = await tryAcquireWinner(slug, record);

  return NextResponse.json({
    ok: true,
    verified: true,
    firstWinner: winner.acquired,
    winnerStore: winner.configured ? "upstash" : "verification-only",
    winner: winner.record,
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
