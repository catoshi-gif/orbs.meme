import { NextResponse } from "next/server";
import { buildRefundTransaction, verifySettledOrbClosed } from "@/lib/orbsProgram";
import { getOrbRecord, recordRefundSettlement } from "@/lib/orbStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const record = await getOrbRecord(slug);
  if (!record || record.status === "funding-pending") return NextResponse.json({ ok: false, error: "Orb not found" }, { status: 404 });
  try {
    const { connection, tx, latest } = await buildRefundTransaction(record);
    const signature = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 3 });
    const confirmation = await connection.confirmTransaction({ signature, ...latest }, "confirmed");
    if (confirmation.value.err) throw new Error("Solana rejected the refund transaction");
    await verifySettledOrbClosed(record, signature);
    await recordRefundSettlement(slug, signature).catch((error) => console.warn("[orbs:refund] Could not persist refund receipt", error));
    return NextResponse.json({ ok: true, signature }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Could not refund Orb" }, { status: 400 });
  }
}
