import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { buildNativeSolUnwrapTransaction } from "@/lib/orbsProgram";
import { getOrbRecord } from "@/lib/orbStore";
import { getCurrentXSession } from "@/lib/xAuth";
import { getWinner } from "@/lib/upstashWinner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;

type Body = { wallet?: unknown };

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const x = await getCurrentXSession();
  if (!x) return NextResponse.json({ ok: false, error: "Reconnect X before converting the SOL prize" }, { status: 401 });
  const { slug } = await params;
  const record = await getOrbRecord(slug);
  if (!record || record.token.isNativeSol !== true) return NextResponse.json({ ok: false, error: "Native SOL prize not found" }, { status: 404 });
  let body: Body;
  try { body = await request.json() as Body; } catch { return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 }); }
  let wallet: PublicKey;
  try { wallet = new PublicKey(typeof body.wallet === "string" ? body.wallet.trim() : ""); }
  catch { return NextResponse.json({ ok: false, error: "Invalid winner wallet" }, { status: 400 }); }

  const winner = await getWinner(record.id);
  if (!winner?.wallet || winner.wallet !== wallet.toBase58() || winner.xUserId !== x.user.id) return NextResponse.json({ ok: false, error: "Only the verified winner can convert this prize to SOL" }, { status: 403 });
  if (!winner.claimTxSignature) return NextResponse.json({ ok: false, error: "Claim the prize before converting WSOL to native SOL" }, { status: 409 });

  try {
    const unwrap = await buildNativeSolUnwrapTransaction(record, wallet);
    return NextResponse.json({ ok: true, unwrap }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Could not prepare SOL conversion" }, { status: 400 });
  }
}
