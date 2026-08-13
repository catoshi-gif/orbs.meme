import { NextResponse } from "next/server";
import { getCurrentXSession } from "@/lib/xAuth";
import { getPublicOrb } from "@/lib/orbStore";
import { createWalletChallenge } from "@/lib/qualification";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [orb, x] = await Promise.all([getPublicOrb(slug), getCurrentXSession()]);
  if (!orb) return NextResponse.json({ ok: false, error: "Orb not found" }, { status: 404 });
  if (!x) return NextResponse.json({ ok: false, error: "Connect X first" }, { status: 401 });
  const body = await request.json().catch(() => ({})) as { wallet?: unknown };
  const wallet = typeof body.wallet === "string" ? body.wallet : "";
  try {
    const challenge = await createWalletChallenge(slug, x.user.id, wallet);
    return NextResponse.json({ ok: true, ...challenge });
  } catch { return NextResponse.json({ ok: false, error: "Invalid wallet" }, { status: 400 }); }
}
