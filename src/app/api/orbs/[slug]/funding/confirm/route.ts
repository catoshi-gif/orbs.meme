import { NextResponse } from "next/server";
import { finalizeFundedOrb, getOrbRecord, getPublicOrb } from "@/lib/orbStore";
import { verifyFundedOrbOnChain } from "@/lib/orbsProgram";
import { getCurrentXSession } from "@/lib/xAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;

type Body = { signature?: unknown };

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const x = await getCurrentXSession();
  if (!x) return NextResponse.json({ ok: false, error: "Reconnect X before confirming Orb funding" }, { status: 401 });
  const { slug } = await params;
  const record = await getOrbRecord(slug);
  if (!record) return NextResponse.json({ ok: false, error: "Orb funding record not found" }, { status: 404 });
  if (record.hostX.id !== x.user.id) return NextResponse.json({ ok: false, error: "Only the Orb host can confirm funding" }, { status: 403 });
  let body: Body;
  try { body = await request.json() as Body; }
  catch { return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 }); }
  const signature = typeof body.signature === "string" ? body.signature.trim() : "";
  try {
    if (record.status !== "funding-pending") {
      const orb = await getPublicOrb(slug);
      return NextResponse.json({ ok: true, orb });
    }
    const chain = await verifyFundedOrbOnChain(record, signature);
    const orb = await finalizeFundedOrb(slug, chain.signature, chain.orbPda, chain.prizeVault);
    return NextResponse.json({ ok: true, orb, shareUrl: `/orb/${orb.slug}` }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Could not verify funding" }, { status: 400 });
  }
}
