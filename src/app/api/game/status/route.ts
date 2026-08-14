import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { getOrbRecord } from "@/lib/orbStore";
import { getWinner, winnerStoreConfigured, type WinnerRecord } from "@/lib/upstashWinner";
import { orbEndsAt } from "@/lib/orbLifecycle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function publicWinner(winner: WinnerRecord | null) {
  if (!winner) return null;
  const { xUserId: _privateXId, wallet: _privateWallet, ...safe } = winner;
  return safe;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const slug = url.searchParams.get("slug")?.trim();
  if (!slug || slug.length > 96 || !/^[a-zA-Z0-9_-]+$/.test(slug)) return NextResponse.json({ ok: false, error: "Invalid Orb slug" }, { status: 400 });
  let requesterWallet: string | null = null;
  const requestedWallet = url.searchParams.get("wallet");
  if (requestedWallet) {
    try { requesterWallet = new PublicKey(requestedWallet).toBase58(); } catch {}
  }
  const orb = await getOrbRecord(slug);
  if (!orb) return NextResponse.json({ ok: false, error: "Orb not found" }, { status: 404 });
  const endsAt = orbEndsAt(orb);
  const winner = winnerStoreConfigured() ? await getWinner(orb.id) : null;
  const now = Date.now();
  return NextResponse.json({
    ok: true,
    configured: winnerStoreConfigured(),
    winner: publicWinner(winner),
    winnerIsRequester: Boolean(winner?.wallet && requesterWallet && winner.wallet === requesterWallet),
    startsAt: orb.startsAt,
    endsAt,
    closed: Boolean(winner) || now >= endsAt,
    phase: winner ? "completed" : now < orb.startsAt ? "upcoming" : now < endsAt ? "live" : "expired",
  }, { headers: { "Cache-Control": "no-store" } });
}
