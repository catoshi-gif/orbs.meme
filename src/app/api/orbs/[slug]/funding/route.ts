import { NextResponse } from "next/server";
import { buildCreateAndFundTransaction, verifyFundedOrbOnChain } from "@/lib/orbsProgram";
import { finalizeFundedOrb, getOrbRecord } from "@/lib/orbStore";
import { getCurrentXSession } from "@/lib/xAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;

export async function POST(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const x = await getCurrentXSession();
  if (!x) return NextResponse.json({ ok: false, error: "Reconnect X before funding this Orb" }, { status: 401 });
  const { slug } = await params;
  const record = await getOrbRecord(slug);
  if (!record || record.status !== "funding-pending") return NextResponse.json({ ok: false, error: "Pending Orb not found" }, { status: 404 });
  if (record.hostX.id !== x.user.id) return NextResponse.json({ ok: false, error: "Only the Orb host can prepare funding" }, { status: 403 });
  try {
    // Recover a broadcast that succeeded before the browser received/confirmed it.
    // If the PDA exists but mismatches the sealed record, fail closed rather than
    // ever attempting a second funding transaction.
    try {
      const chain = await verifyFundedOrbOnChain(record);
      const orb = await finalizeFundedOrb(slug, chain.signature, chain.orbPda, chain.prizeVault);
      return NextResponse.json({ ok: true, alreadyFunded: true, orb }, { headers: { "Cache-Control": "private, no-store" } });
    } catch (recoveryError) {
      if (!(recoveryError instanceof Error) || recoveryError.message !== "ORB_NOT_FUNDED") throw recoveryError;
    }
    const funding = await buildCreateAndFundTransaction(record);
    return NextResponse.json({ ok: true, funding }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Could not build funding transaction" }, { status: 400 });
  }
}
