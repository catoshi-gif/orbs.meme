import { NextResponse } from "next/server";
import { PublicKey, Transaction } from "@solana/web3.js";
import { getOrbRecord } from "@/lib/orbStore";
import { buildClaimInstruction, loadVerifiedOrbState, serverRelayerKeypair, turnkeyClaimAddress } from "@/lib/orbsProgram";
import { signOrbsClaimTransaction } from "@/lib/turnkeyServer";
import { getCurrentXSession } from "@/lib/xAuth";
import { getWinner } from "@/lib/upstashWinner";
import { ORBS_RENT_RECEIVER_WALLET } from "@/lib/solanaAddresses";
import { redisCommand } from "@/lib/upstash";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

type Body = { wallet?: unknown };

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const x = await getCurrentXSession();
  if (!x) return NextResponse.json({ ok: false, error: "Reconnect X before claiming this Orb" }, { status: 401 });
  const { slug } = await params;
  const record = await getOrbRecord(slug);
  if (!record || record.status === "funding-pending") return NextResponse.json({ ok: false, error: "Orb not found" }, { status: 404 });
  let body: Body;
  try { body = await request.json() as Body; } catch { return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 }); }
  let winnerWallet: PublicKey;
  try { winnerWallet = new PublicKey(typeof body.wallet === "string" ? body.wallet.trim() : ""); }
  catch { return NextResponse.json({ ok: false, error: "Invalid winner wallet" }, { status: 400 }); }

  const winner = await getWinner(record.id);
  if (!winner?.wallet || winner.wallet !== winnerWallet.toBase58() || winner.xUserId !== x.user.id) {
    return NextResponse.json({ ok: false, error: "Only the verified first winner can prepare this claim" }, { status: 403 });
  }
  if (winner.claimTxSignature) return NextResponse.json({ ok: false, error: "This prize has already been claimed" }, { status: 409 });

  // Turnkey signing is intentionally rate-limited and briefly cached so browser
  // retries cannot burn signing credits or create a signing storm. The cache is
  // shorter than a normal Solana blockhash lifetime.
  const prepKey = `orbs:v1:claim-prep:${record.id}:${winnerWallet.toBase58()}`;
  const budgetKey = `orbs:v1:claim-budget:${record.id}:${winnerWallet.toBase58()}`;
  const cached = await redisCommand<string>(["GET", prepKey]);
  if (cached) {
    try {
      const parsed = JSON.parse(cached) as { claim: unknown };
      return NextResponse.json({ ok: true, ...parsed }, { headers: { "Cache-Control": "private, no-store" } });
    } catch {}
  }
  const count = await redisCommand<number>(["INCR", budgetKey]);
  if (count === null) {
    return NextResponse.json(
      { ok: false, error: "Protected claim signing is temporarily unavailable. Please retry shortly." },
      { status: 503 },
    );
  }
  if (count === 1) await redisCommand<number>(["EXPIRE", budgetKey, "86400"]);
  if (count > 10) return NextResponse.json({ ok: false, error: "Claim signing retry limit reached for this Orb. Contact Orbs support if the prize is still unclaimed." }, { status: 429 });
  const lockKey = `${prepKey}:lock`;
  const lock = await redisCommand<string>(["SET", lockKey, "1", "NX", "EX", "20"]);
  if (lock !== "OK") return NextResponse.json({ ok: false, error: "A protected claim is already being prepared. Retry in a few seconds." }, { status: 429 });

  try {
    const state = await loadVerifiedOrbState(record);
    const now = BigInt(Math.floor(Date.now() / 1000));
    if (now < state.decoded.startsAt) throw new Error("Game has not started");
    if (now >= state.decoded.refundAfter) throw new Error("The claim window has expired; the host refund path is now active");
    const claim = buildClaimInstruction(record, winnerWallet, ORBS_RENT_RECEIVER_WALLET);
    if (!claim.claimAuthority.equals(turnkeyClaimAddress())) throw new Error("Turnkey claim authority mismatch");
    const latest = await state.connection.getLatestBlockhash("confirmed");
    const relayer = serverRelayerKeypair();
    const tx = new Transaction({ feePayer: relayer.publicKey, recentBlockhash: latest.blockhash }).add(claim.instruction);
    tx.partialSign(relayer);
    const turnkeySigned = await signOrbsClaimTransaction(tx);
    const responsePayload = {
      claim: {
        transactionBase64: turnkeySigned.serialize({ requireAllSignatures: false, verifySignatures: true }).toString("base64"),
        blockhash: latest.blockhash,
        lastValidBlockHeight: latest.lastValidBlockHeight,
        claimAuthority: claim.claimAuthority.toBase58(),
      },
    };
    await redisCommand<string>(["SET", prepKey, JSON.stringify(responsePayload), "EX", "60"]);
    return NextResponse.json({ ok: true, ...responsePayload }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Could not prepare claim" }, { status: 400 });
  } finally {
    await redisCommand<number>(["DEL", lockKey]);
  }
}
