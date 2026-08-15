import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { getPublicOrb } from "@/lib/orbStore";
import { hashXUserId, verifyCompetitiveSession } from "@/lib/competitiveSession";
import { getCurrentXSession } from "@/lib/xAuth";
import { orbEndsAt } from "@/lib/orbLifecycle";
import { recordLiveRacerAnalytics } from "@/lib/durableAnalytics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function normalizeWallet(value: unknown) {
  if (typeof value !== "string") return null;
  try { return new PublicKey(value).toBase58(); } catch { return null; }
}

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [orb, x] = await Promise.all([getPublicOrb(slug), getCurrentXSession()]);
  if (!orb || !x) return NextResponse.json({ ok: false }, { status: 401 });
  if (Date.now() < orb.startsAt || Date.now() >= orbEndsAt(orb)) return NextResponse.json({ ok: false }, { status: 409 });

  const body = await request.json().catch(() => ({})) as { wallet?: unknown; competitiveSession?: unknown };
  const wallet = normalizeWallet(body.wallet);
  const token = typeof body.competitiveSession === "string" ? body.competitiveSession : "";
  const session = token ? verifyCompetitiveSession(token) : null;
  if (!wallet || !session) return NextResponse.json({ ok: false }, { status: 401 });
  if (session.orbId !== orb.id || session.slug !== slug || session.wallet !== wallet || session.xUserHash !== hashXUserId(x.user.id)) {
    return NextResponse.json({ ok: false }, { status: 403 });
  }

  await recordLiveRacerAnalytics(
    slug,
    `${x.user.id}:${wallet}`,
    Math.max(60 * 60 * 24 * 2, Math.ceil((orbEndsAt(orb) - Date.now()) / 1000) + 60 * 60 * 24),
  );
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "private, no-store" } });
}
