import { NextResponse } from "next/server";
import { getCurrentXSession } from "@/lib/xAuth";
import { getPublicOrb } from "@/lib/orbStore";
import { createWalletChallenge } from "@/lib/qualification";
import { orbEndsAt } from "@/lib/orbLifecycle";
import { getWinner } from "@/lib/upstashWinner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [orb, x] = await Promise.all([getPublicOrb(slug), getCurrentXSession()]);
  if (!orb) return NextResponse.json({ ok: false, error: "Orb not found" }, { status: 404 });
  if (!x) return NextResponse.json({ ok: false, error: "Connect X first" }, { status: 401 });
  if (Date.now() >= orbEndsAt(orb) || await getWinner(orb.id)) return NextResponse.json({ ok: false, error: "This Orb is already closed." }, { status: 409 });
  const body = await request.json().catch(() => ({})) as { wallet?: unknown };
  const wallet = typeof body.wallet === "string" ? body.wallet : "";
  try {
    const challenge = await createWalletChallenge(slug, x.user.id, wallet);
    return NextResponse.json({ ok: true, ...challenge });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not create wallet challenge";
    const invalid = /invalid public key/i.test(message);
    return NextResponse.json({ ok: false, error: invalid ? "Invalid wallet" : message }, { status: invalid ? 400 : 503 });
  }
}
