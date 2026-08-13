import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { createTestOrb } from "@/lib/orbStore";
import { getWalletSplTokens } from "@/lib/walletTokens";
import { verifyPrizeQuote } from "@/lib/prizeQuote";
import { MIN_PRIZE_USD, ORBS_FEE_USD, rawToTokenNumber, tokenInputToRaw } from "@/lib/prizeEconomics";
import { getCurrentXSession } from "@/lib/xAuth";
import { normalizeDifficulty } from "@/game/maze";
import { DEFAULT_GAME_STYLE } from "@/game/constants";
import { safeColor } from "@/game/theme";
import type { GameStyle } from "@/game/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;

type Body = {
  hostWallet?: unknown;
  mint?: unknown;
  prizeTokenAmount?: unknown;
  prizeQuoteToken?: unknown;
  difficulty?: unknown;
  style?: Partial<Record<keyof GameStyle, unknown>>;
  startsAt?: unknown;
};

export async function POST(request: Request) {
  const x = await getCurrentXSession();
  if (!x) return NextResponse.json({ ok: false, error: "Connect X before creating an Orb" }, { status: 401 });
  if (x.user.protected) return NextResponse.json({ ok: false, error: "Orb hosts must use a public X account" }, { status: 400 });

  let body: Body;
  try { body = await request.json(); } catch { return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 }); }

  const hostWallet = typeof body.hostWallet === "string" ? body.hostWallet.trim() : "";
  try { new PublicKey(hostWallet); } catch { return NextResponse.json({ ok: false, error: "Invalid host wallet" }, { status: 400 }); }

  const mint = typeof body.mint === "string" ? body.mint.trim() : "";
  const prizeText = typeof body.prizeTokenAmount === "string"
    ? body.prizeTokenAmount.trim()
    : typeof body.prizeTokenAmount === "number" && Number.isFinite(body.prizeTokenAmount)
      ? String(body.prizeTokenAmount)
      : "";
  const prizeQuoteToken = typeof body.prizeQuoteToken === "string" ? body.prizeQuoteToken.trim() : "";
  const startsAt = Number(body.startsAt);
  const style: GameStyle = {
    marble: safeColor(typeof body.style?.marble === "string" ? body.style.marble : undefined, DEFAULT_GAME_STYLE.marble),
    marbleSecondary: safeColor(typeof body.style?.marbleSecondary === "string" ? body.style.marbleSecondary : undefined, DEFAULT_GAME_STYLE.marbleSecondary),
    walls: safeColor(typeof body.style?.walls === "string" ? body.style.walls : undefined, DEFAULT_GAME_STYLE.walls),
    floor: safeColor(typeof body.style?.floor === "string" ? body.style.floor : undefined, DEFAULT_GAME_STYLE.floor),
    accent: safeColor(typeof body.style?.accent === "string" ? body.style.accent : undefined, DEFAULT_GAME_STYLE.accent),
  };

  try {
    const quote = prizeQuoteToken ? verifyPrizeQuote(prizeQuoteToken) : null;
    if (!quote) throw new Error("Your funding quote expired. Go back to Prize and reopen the token list to refresh it.");
    if (quote.wallet !== hostWallet || quote.mint !== mint) throw new Error("Funding quote does not match this wallet and token");

    // Re-read Helius at the final action so the browser never gets to assert its
    // own balance. Jupiter may have moved since the quote, but the signed quote
    // intentionally freezes the exact token fee the host reviewed.
    const walletTokens = await getWalletSplTokens(hostWallet);
    const token = walletTokens.find((candidate) => candidate.mint === mint);
    if (!token) return NextResponse.json({ ok: false, error: "Selected SPL token is not currently in this wallet" }, { status: 400 });
    if (token.decimals !== quote.decimals) throw new Error("Token decimals changed unexpectedly");

    const prizeRaw = tokenInputToRaw(prizeText, token.decimals);
    if (prizeRaw === null || prizeRaw <= BigInt(0)) throw new Error("Invalid prize amount");
    const feeRaw = BigInt(quote.feeRawAmount);
    const liveBalanceRaw = BigInt(token.rawAmount);
    if (prizeRaw + feeRaw > liveBalanceRaw) {
      const totalUsd = rawToTokenNumber(prizeRaw + feeRaw, token.decimals) * quote.usdPrice;
      const balanceUsd = rawToTokenNumber(liveBalanceRaw, token.decimals) * quote.usdPrice;
      throw new Error(`Funding total is $${totalUsd.toFixed(2)} but this wallet has about $${balanceUsd.toFixed(2)} at the locked quote. Go back to Prize and press Max to use the exact available balance.`);
    }

    const prizeTokenAmount = rawToTokenNumber(prizeRaw, token.decimals);
    const prizeUsd = prizeTokenAmount * quote.usdPrice;
    if (prizeUsd < MIN_PRIZE_USD) throw new Error(`Winner prize must be at least $${MIN_PRIZE_USD.toFixed(2)} before the $${ORBS_FEE_USD.toFixed(2)} Orbs fee`);

    const orb = await createTestOrb({
      hostWallet,
      hostX: x.user,
      difficulty: normalizeDifficulty(typeof body.difficulty === "string" ? body.difficulty : undefined),
      style,
      token,
      prizeTokenAmount,
      prizeRawAmount: prizeRaw.toString(),
      quotedUsdPrice: quote.usdPrice,
      feeRawAmount: quote.feeRawAmount,
      priceQuotedAt: quote.issuedAt,
      startsAt,
    });
    return NextResponse.json({ ok: true, orb, shareUrl: `/orb/${orb.slug}` });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Could not create Orb" }, { status: 400 });
  }
}
