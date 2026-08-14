import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { getOrbRecord } from "@/lib/orbStore";
import { verifyClaimedOrbOnChain } from "@/lib/orbsProgram";
import { getCurrentXSession } from "@/lib/xAuth";
import { getWinner, markWinnerClaimed } from "@/lib/upstashWinner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;

type Body = { wallet?: unknown; signature?: unknown };
export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const x = await getCurrentXSession();
  if (!x) return NextResponse.json({ ok: false, error: "Reconnect X before confirming your claim" }, { status: 401 });
  const { slug } = await params;
  const record = await getOrbRecord(slug);
  if (!record || record.status === "funding-pending") return NextResponse.json({ ok: false, error: "Orb not found" }, { status: 404 });
  let body: Body;
  try { body = await request.json() as Body; } catch { return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 }); }
  const wallet = typeof body.wallet === "string" ? body.wallet.trim() : "";
  const signature = typeof body.signature === "string" ? body.signature.trim() : "";
  try { new PublicKey(wallet); } catch { return NextResponse.json({ ok: false, error: "Invalid wallet" }, { status: 400 }); }
  if (!signature) return NextResponse.json({ ok: false, error: "Missing claim signature" }, { status: 400 });
  const winner = await getWinner(record.id);
  if (!winner?.wallet || winner.wallet !== wallet || winner.xUserId !== x.user.id) return NextResponse.json({ ok: false, error: "Winner identity mismatch" }, { status: 403 });
  try {
    await verifyClaimedOrbOnChain(record, new PublicKey(wallet), signature);
    const updated = await markWinnerClaimed(record.id, wallet, signature);
    return NextResponse.json({ ok: true, claimedAt: updated.claimedAt, signature }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Could not verify claim" }, { status: 400 });
  }
}
