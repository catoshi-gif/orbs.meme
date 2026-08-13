import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { createHostAuthorizationChallenge } from "@/lib/hostAuthorization";
import { tokenInputToRaw } from "@/lib/prizeEconomics";
import { verifyPrizeQuote } from "@/lib/prizeQuote";
import { getCurrentXSession } from "@/lib/xAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  wallet?: unknown;
  mint?: unknown;
  prizeTokenAmount?: unknown;
  prizeQuoteToken?: unknown;
  startsAt?: unknown;
};

export async function POST(request: Request) {
  const x = await getCurrentXSession();
  if (!x) return NextResponse.json({ ok: false, error: "Connect X before creating an Orb" }, { status: 401 });
  const body = await request.json().catch(() => ({})) as Body;
  if (typeof body.wallet !== "string" || typeof body.mint !== "string" || typeof body.prizeQuoteToken !== "string") {
    return NextResponse.json({ ok: false, error: "Invalid funding authorization request" }, { status: 400 });
  }
  let wallet: string;
  let mint: string;
  try {
    wallet = new PublicKey(body.wallet).toBase58();
    mint = new PublicKey(body.mint).toBase58();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid wallet or token mint" }, { status: 400 });
  }
  try {
    const quote = verifyPrizeQuote(body.prizeQuoteToken);
    if (!quote || quote.wallet !== wallet || quote.mint !== mint) throw new Error("Funding quote expired or does not match this wallet and token");
    const prizeText = typeof body.prizeTokenAmount === "string"
      ? body.prizeTokenAmount.trim()
      : typeof body.prizeTokenAmount === "number" && Number.isFinite(body.prizeTokenAmount)
        ? String(body.prizeTokenAmount)
        : "";
    const prizeRaw = tokenInputToRaw(prizeText, quote.decimals);
    if (prizeRaw === null || prizeRaw <= BigInt(0)) throw new Error("Invalid prize amount");
    const startsAt = Number(body.startsAt);
    const startsAtUnixSeconds = Math.floor(startsAt / 1000);
    if (!Number.isFinite(startsAt) || !Number.isInteger(startsAtUnixSeconds) || startsAtUnixSeconds <= Math.floor(Date.now() / 1000)) {
      throw new Error("Invalid launch time");
    }
    const challenge = await createHostAuthorizationChallenge(wallet, x.user.id, {
      mint,
      prizeRawAmount: prizeRaw.toString(),
      feeRawAmount: quote.feeRawAmount,
      decimals: quote.decimals,
      startsAtUnixSeconds,
    });
    return NextResponse.json({ ok: true, ...challenge }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof Error && !/STORAGE_UNAVAILABLE/.test(error.message)) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    }
    console.error("[orbs:host-authorization] Could not store creator challenge", error);
    return NextResponse.json({ ok: false, error: "Creator authorization is temporarily unavailable" }, { status: 503 });
  }
}
