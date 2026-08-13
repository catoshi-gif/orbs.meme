import { NextResponse } from "next/server";
import { getCurrentXSession } from "@/lib/xAuth";
import { getPublicOrb } from "@/lib/orbStore";
import { hasWalletProof, verifyWalletChallenge } from "@/lib/qualification";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const x = await getCurrentXSession();
  const wallet = new URL(request.url).searchParams.get("wallet") || "";
  if (!x) return NextResponse.json({ ok: true, verified: false });
  return NextResponse.json({ ok: true, verified: await hasWalletProof(slug, x.user.id, wallet) });
}

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [orb, x] = await Promise.all([getPublicOrb(slug), getCurrentXSession()]);
  if (!orb) return NextResponse.json({ ok: false, error: "Orb not found" }, { status: 404 });
  if (!x) return NextResponse.json({ ok: false, error: "Connect X first" }, { status: 401 });
  const body = await request.json().catch(() => ({})) as { wallet?: unknown; signature?: unknown };
  const wallet = typeof body.wallet === "string" ? body.wallet : "";
  const signature = typeof body.signature === "string" ? body.signature : "";
  try {
    const verified = await verifyWalletChallenge(slug, x.user.id, wallet, signature);
    return NextResponse.json({ ok: verified, verified }, { status: verified ? 200 : 422 });
  } catch (error) { return NextResponse.json({ ok: false, verified: false, error: error instanceof Error ? error.message : "Wallet signature rejected" }, { status: 422 }); }
}
