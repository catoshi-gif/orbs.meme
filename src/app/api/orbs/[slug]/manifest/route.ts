import { NextResponse } from "next/server";
import { getCanonicalOrbManifest, getPublicOrb } from "@/lib/orbStore";
import { getWinner } from "@/lib/upstashWinner";
import { orbEndsAt } from "@/lib/orbLifecycle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;

/**
 * Public fairness/audit endpoint.
 *
 * The competitive browser receives its exact manifest only from the signed-session endpoint
 * after X + follow + wallet + Turnstile qualification. Keeping this public route sealed until
 * the race has a winner removes a free machine-readable maze feed during the competition.
 * After a winner exists or the competition expires, the canonical manifest becomes public
 * for independent audit without leaking the maze during an active race.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const publicOrb = await getPublicOrb(slug);
  if (!publicOrb) return NextResponse.json({ ok: false, error: "Orb not found" }, { status: 404 });
  if (Date.now() < publicOrb.startsAt) {
    return NextResponse.json(
      { ok: false, error: "GAME_NOT_LIVE", startsAt: publicOrb.startsAt, commitment: publicOrb.commitment },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  }

  const winner = await getWinner(publicOrb.id);
  if (!winner && Date.now() < orbEndsAt(publicOrb)) {
    return NextResponse.json(
      { ok: false, error: "COMPETITION_ACTIVE", commitment: publicOrb.commitment },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const { manifest, manifestHash } = await getCanonicalOrbManifest(slug);
    return NextResponse.json(
      { ok: true, manifest, manifestHash, commitment: publicOrb.commitment },
      { headers: { "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800" } },
    );
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Manifest unavailable" }, { status: 409 });
  }
}
