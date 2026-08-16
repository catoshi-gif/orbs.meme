import { NextResponse } from "next/server";
import { hasEligibilityReceipt } from "@/lib/eligibility";
import { PublicKey } from "@solana/web3.js";
import { getCanonicalOrbManifest, getPublicOrb, orbGameType } from "@/lib/orbStore";
import { issueCompetitiveSession, competitiveSessionsConfigured } from "@/lib/competitiveSession";
import { hasFollowProof, hasShareProof, hasWalletProof } from "@/lib/qualification";
import { hasHumanProof } from "@/lib/turnstile";
import { getCurrentXSession } from "@/lib/xAuth";
import { orbEndsAt } from "@/lib/orbLifecycle";
import { getWinner } from "@/lib/upstashWinner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;

function normalizeWallet(value: unknown) {
  if (typeof value !== "string") return null;
  try { return new PublicKey(value).toBase58(); } catch { return null; }
}

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [orb, x] = await Promise.all([getPublicOrb(slug), getCurrentXSession()]);
  if (!orb) return NextResponse.json({ ok: false, error: "Orb not found" }, { status: 404 });
  if (orbGameType(orb) === "arena") return NextResponse.json({ ok: false, error: "ARENA_REALTIME_REQUIRED" }, { status: 503 });
  if (!x) return NextResponse.json({ ok: false, error: "Connect X first" }, { status: 401 });
  if (!competitiveSessionsConfigured()) return NextResponse.json({ ok: false, error: "Competitive session signing is not configured" }, { status: 503 });
  if (Date.now() < orb.startsAt) return NextResponse.json({ ok: false, error: "GAME_NOT_LIVE", startsAt: orb.startsAt, commitment: orb.commitment }, { status: 403 });
  const endsAt = orbEndsAt(orb);
  const winner = await getWinner(orb.id);
  if (winner || Date.now() >= endsAt) return NextResponse.json({ ok: false, error: "ORB_CLOSED", endsAt, winner: Boolean(winner) }, { status: 409 });

  const body = await request.json().catch(() => ({})) as { wallet?: unknown };
  const wallet = normalizeWallet(body.wallet);
  if (!wallet) return NextResponse.json({ ok: false, error: "Invalid wallet" }, { status: 400 });

  if (!await hasEligibilityReceipt(wallet)) return NextResponse.json({ ok: false, error: "Confirm 18+ eligibility for this wallet before entering an Orb" }, { status: 403 });

  const [followed, walletVerified, humanVerified, shared] = await Promise.all([
    hasFollowProof(x.user.id, orb.hostX.id),
    hasWalletProof(slug, x.user.id, wallet),
    hasHumanProof(slug, x.user.id, wallet),
    hasShareProof(slug, x.user.id, wallet),
  ]);
  if (!followed) return NextResponse.json({ ok: false, error: "Host follow is not confirmed" }, { status: 403 });
  if (!walletVerified) return NextResponse.json({ ok: false, error: "Wallet ownership is not verified" }, { status: 403 });
  if (!humanVerified) return NextResponse.json({ ok: false, error: "Human check is not verified" }, { status: 403 });
  if (!shared) return NextResponse.json({ ok: false, error: "Your Orb entry post is not verified" }, { status: 403 });

  try {
    const { record, manifest, manifestHash } = await getCanonicalOrbManifest(slug);
    const issued = issueCompetitiveSession({
      orbId: record.id,
      slug,
      wallet,
      xUserId: x.user.id,
      manifestHash,
      expiresAt: orbEndsAt(record),
    });
    return NextResponse.json({
      ok: true,
      session: issued.token,
      manifest,
      manifestHash,
      endsAt,
      entrant: { wallet, x: { id: x.user.id, username: x.user.username, name: x.user.name, profileImageUrl: x.user.profileImageUrl || null } },
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not issue game session";
    return NextResponse.json({ ok: false, error: message }, { status: message === "ORB_NOT_LIVE" ? 403 : 409 });
  }
}
