import { NextResponse } from "next/server";
import { hasEligibilityReceipt } from "@/lib/eligibility";
import { PublicKey } from "@solana/web3.js";
import { createTestOrb, finalizeFundedOrb, getActiveHostedOrb, getOrbRecord, listHostedOrbs, type OrbGameType } from "@/lib/orbStore";
import { getWalletSplTokens } from "@/lib/walletTokens";
import { usdMicrosForRawAmount, verifyPrizeQuote } from "@/lib/prizeQuote";
import { MIN_PRIZE_USD, ORBS_FEE_USD, rawToTokenNumber, tokenInputToRaw } from "@/lib/prizeEconomics";
import { getCurrentXSession } from "@/lib/xAuth";
import { normalizeDifficulty } from "@/game/maze";
import { DEFAULT_GAME_STYLE } from "@/game/constants";
import { safeColor } from "@/game/theme";
import type { GameStyle } from "@/game/types";
import { listWalletOrbActivity } from "@/lib/orbActivity";
import { isAdminWallet } from "@/lib/orbLifecycle";
import { consumeHostAuthorization } from "@/lib/hostAuthorization";
import { verifyFundedOrbOnChain } from "@/lib/orbsProgram";
import { arenaRuntimeConfigured } from "@/lib/arenaRuntime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;

async function reconcileRecentHostedFunding(wallet: string, xUserId: string) {
  const hosted = await listHostedOrbs(wallet, 20);
  const pending = hosted
    .filter((orb) => orb.status === "funding-pending")
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 8);
  for (const candidate of pending) {
    const record = await getOrbRecord(candidate.slug);
    if (!record || record.status !== "funding-pending" || record.hostX.id !== xUserId) continue;
    try {
      const chain = await verifyFundedOrbOnChain(record, record.fundingBroadcastSignature || "");
      await finalizeFundedOrb(record.slug, chain.signature, chain.orbPda, chain.prizeVault);
    } catch (error) {
      if (error instanceof Error && (error.message === "ORB_NOT_FUNDED" || /not yet visible/i.test(error.message))) continue;
      console.warn(`[orbs:reconcile] Could not reconcile ${record.slug}`, error);
    }
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const hostWallet = (url.searchParams.get("wallet") || url.searchParams.get("hostWallet"))?.trim() || "";
  let normalized: string;
  try { normalized = new PublicKey(hostWallet).toBase58(); }
  catch { return NextResponse.json({ ok: false, error: "Invalid host wallet" }, { status: 400 }); }
  try {
    const x = await getCurrentXSession();
    if (x) await reconcileRecentHostedFunding(normalized, x.user.id);
    const [activities, activeOrb] = await Promise.all([
      listWalletOrbActivity(normalized),
      getActiveHostedOrb(normalized),
    ]);
    return NextResponse.json({
      ok: true,
      activities,
      orbs: activities.filter((activity) => activity.hosted).map((activity) => activity.orb),
      creationPolicy: { adminExempt: isAdminWallet(normalized), activeOrb },
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Could not load wallet activity" }, { status: 503 });
  }
}

type Body = {
  hostWallet?: unknown;
  mint?: unknown;
  prizeTokenAmount?: unknown;
  prizeQuoteToken?: unknown;
  gameType?: unknown;
  difficulty?: unknown;
  style?: Partial<Record<keyof GameStyle, unknown>>;
  startsAt?: unknown;
  hostAuthorizationSignature?: unknown;
};

export async function POST(request: Request) {
  const x = await getCurrentXSession();
  if (!x) return NextResponse.json({ ok: false, error: "Connect X before creating an Orb" }, { status: 401 });
  if (x.user.protected) return NextResponse.json({ ok: false, error: "Orb hosts must use a public X account" }, { status: 400 });

  let body: Body;
  try { body = await request.json(); } catch { return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 }); }

  let hostWallet = typeof body.hostWallet === "string" ? body.hostWallet.trim() : "";
  try { hostWallet = new PublicKey(hostWallet).toBase58(); } catch { return NextResponse.json({ ok: false, error: "Invalid host wallet" }, { status: 400 }); }
  if (!await hasEligibilityReceipt(hostWallet)) return NextResponse.json({ ok: false, error: "Confirm 18+ eligibility for this wallet before creating an Orb" }, { status: 403 });
  const hostAuthorizationSignature = typeof body.hostAuthorizationSignature === "string" ? body.hostAuthorizationSignature.trim() : "";
  if (!hostAuthorizationSignature) return NextResponse.json({ ok: false, error: "Approve the host-wallet authorization before creating this Orb" }, { status: 401 });

  const mint = typeof body.mint === "string" ? body.mint.trim() : "";
  const prizeText = typeof body.prizeTokenAmount === "string"
    ? body.prizeTokenAmount.trim()
    : typeof body.prizeTokenAmount === "number" && Number.isFinite(body.prizeTokenAmount)
      ? String(body.prizeTokenAmount)
      : "";
  const prizeQuoteToken = typeof body.prizeQuoteToken === "string" ? body.prizeQuoteToken.trim() : "";
  const startsAt = Number(body.startsAt);
  const gameType: OrbGameType = body.gameType === "arena" ? "arena" : "maze";
  if (gameType === "arena" && !arenaRuntimeConfigured()) {
    return NextResponse.json({ ok: false, error: "Arena creation requires the authoritative realtime Arena service to be configured." }, { status: 503 });
  }
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
    const authorizedPrizeRaw = tokenInputToRaw(prizeText, quote.decimals);
    if (authorizedPrizeRaw === null || authorizedPrizeRaw <= BigInt(0)) throw new Error("Invalid prize amount");
    const hostAuthorized = await consumeHostAuthorization(hostWallet, x.user.id, hostAuthorizationSignature, {
      mint,
      prizeRawAmount: authorizedPrizeRaw.toString(),
      feeRawAmount: quote.feeRawAmount,
      decimals: quote.decimals,
      startsAtUnixSeconds: Math.floor(startsAt / 1000),
    });
    if (!hostAuthorized) return NextResponse.json({ ok: false, error: "Host funding authorization expired, changed, or was rejected. Please review and approve the exact funding intent again." }, { status: 401 });
    const activeOrb = await getActiveHostedOrb(hostWallet);
    if (activeOrb) {
      return NextResponse.json({ ok: false, error: `This wallet already has active Orb ${activeOrb.slug}. It can create another after that race closes.`, activeOrb }, { status: 409 });
    }

    // Re-read Helius at the final action so the browser never gets to assert its
    // own balance. Jupiter may have moved since the quote, but the signed quote
    // intentionally freezes the exact token fee the host reviewed.
    const walletTokens = await getWalletSplTokens(hostWallet);
    const token = walletTokens.find((candidate) => candidate.mint === mint);
    if (!token) return NextResponse.json({ ok: false, error: "Selected SOL/SPL asset is not currently in this wallet" }, { status: 400 });
    if (token.decimals !== quote.decimals) throw new Error("Token decimals changed unexpectedly");

    const prizeRaw = tokenInputToRaw(prizeText, token.decimals);
    if (prizeRaw === null || prizeRaw <= BigInt(0) || prizeRaw !== authorizedPrizeRaw) throw new Error("Authorized prize amount no longer matches the funding request");
    const feeRaw = BigInt(quote.feeRawAmount);
    const liveBalanceRaw = BigInt(token.rawAmount);
    if (prizeRaw + feeRaw > liveBalanceRaw) {
      const totalUsd = rawToTokenNumber(prizeRaw + feeRaw, token.decimals) * quote.usdPrice;
      const balanceUsd = rawToTokenNumber(liveBalanceRaw, token.decimals) * quote.usdPrice;
      throw new Error(`Funding total is $${totalUsd.toFixed(2)} but this wallet has about $${balanceUsd.toFixed(2)} at the locked quote. Go back to Prize and press Max to use the exact available balance.`);
    }

    const prizeTokenAmount = rawToTokenNumber(prizeRaw, token.decimals);
    const prizeUsdMicros = usdMicrosForRawAmount(prizeRaw, token.decimals, quote.usdPrice);
    const minimumPrizeUsdMicros = BigInt(Math.round(MIN_PRIZE_USD * 1_000_000));
    if (prizeUsdMicros < minimumPrizeUsdMicros) {
      throw new Error(`Total commitment must leave at least $${MIN_PRIZE_USD.toFixed(2)} for the winner after the $${ORBS_FEE_USD.toFixed(2)} Orbs fee`);
    }

    const orb = await createTestOrb({
      hostWallet,
      hostX: x.user,
      gameType,
      difficulty: normalizeDifficulty(typeof body.difficulty === "string" ? body.difficulty : undefined),
      style,
      token,
      prizeTokenAmount,
      prizeRawAmount: prizeRaw.toString(),
      quotedUsdPrice: quote.usdPrice,
      feeRawAmount: quote.feeRawAmount,
      priceQuotedAt: quote.issuedAt,
      fundingQuoteExpiresAt: quote.expiresAt,
      startsAt,
    });
    return NextResponse.json({ ok: true, orb });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not create Orb";
    const status = /already has an active Orb/i.test(message)
      ? 409
      : /temporarily unavailable|not configured|Upstash request failed/i.test(message)
        ? 503
        : 400;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
