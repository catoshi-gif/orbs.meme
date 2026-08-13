import { NextResponse } from "next/server";
import { getOrbRecord } from "@/lib/orbStore";
import { getWinner, winnerStoreConfigured, type WinnerRecord } from "@/lib/upstashWinner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function publicWinner(winner: WinnerRecord | null) {
  if (!winner) return null;
  const { xUserId: _privateXId, ...safe } = winner;
  return safe;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const slug = url.searchParams.get("slug")?.trim();
  if (!slug || slug.length > 96 || !/^[a-zA-Z0-9_-]+$/.test(slug)) return NextResponse.json({ ok: false, error: "Invalid Orb slug" }, { status: 400 });
  if (!winnerStoreConfigured()) return NextResponse.json({ ok: true, configured: false, winner: null }, { headers: { "Cache-Control": "no-store" } });
  const orb = await getOrbRecord(slug);
  return NextResponse.json({ ok: true, configured: true, winner: publicWinner(await getWinner(orb?.id || slug)) }, { headers: { "Cache-Control": "no-store" } });
}
