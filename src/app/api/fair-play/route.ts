import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { FAIR_PLAY_TERMS_VERSION, FAIR_PLAY_VERSION, hasFairPlayReceipt, saveFairPlayReceipt } from "@/lib/fairPlay";
import { hasEligibilityReceipt } from "@/lib/eligibility";
import { hasWalletProof } from "@/lib/qualification";
import { getCurrentXSession } from "@/lib/xAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function walletOf(value: unknown) {
  if (typeof value !== "string") return null;
  try { return new PublicKey(value).toBase58(); } catch { return null; }
}

export async function GET(request: Request) {
  const x = await getCurrentXSession();
  if (!x) return NextResponse.json({ ok: true, accepted: false, version: FAIR_PLAY_VERSION, termsVersion: FAIR_PLAY_TERMS_VERSION }, { headers: { "Cache-Control": "private, no-store" } });
  const wallet = walletOf(new URL(request.url).searchParams.get("wallet"));
  if (!wallet) return NextResponse.json({ ok: true, accepted: false, version: FAIR_PLAY_VERSION, termsVersion: FAIR_PLAY_TERMS_VERSION }, { headers: { "Cache-Control": "private, no-store" } });
  try {
    return NextResponse.json({ ok: true, accepted: await hasFairPlayReceipt(wallet, x.user.id), version: FAIR_PLAY_VERSION, termsVersion: FAIR_PLAY_TERMS_VERSION }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ ok: false, accepted: false, version: FAIR_PLAY_VERSION, termsVersion: FAIR_PLAY_TERMS_VERSION, error: "Fair Play status is temporarily unavailable" }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const x = await getCurrentXSession();
  if (!x) return NextResponse.json({ ok: false, error: "Connect X before accepting the Fair Play Policy" }, { status: 401 });
  const body = await request.json().catch(() => ({})) as { wallet?: unknown; slug?: unknown; accepted?: unknown };
  const wallet = walletOf(body.wallet);
  const slug = typeof body.slug === "string" ? body.slug.trim() : "";
  if (!wallet || !slug || body.accepted !== true) return NextResponse.json({ ok: false, error: "Invalid Fair Play acceptance" }, { status: 400 });
  try {
    const [eligible, walletVerified] = await Promise.all([
      hasEligibilityReceipt(wallet),
      hasWalletProof(slug, x.user.id, wallet),
    ]);
    if (!eligible || !walletVerified) return NextResponse.json({ ok: false, error: "Verify your wallet and eligibility before accepting Fair Play" }, { status: 403 });
    await saveFairPlayReceipt(wallet, x.user.id);
    return NextResponse.json({ ok: true, accepted: true, version: FAIR_PLAY_VERSION, termsVersion: FAIR_PLAY_TERMS_VERSION }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Fair Play acceptance could not be saved" }, { status: 503 });
  }
}
