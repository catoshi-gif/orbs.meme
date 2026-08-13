import { NextResponse } from "next/server";
import { getWinner, winnerStoreConfigured } from "@/lib/upstashWinner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const slug = url.searchParams.get("slug")?.trim();
  if (!slug || slug.length > 96 || !/^[a-zA-Z0-9_-]+$/.test(slug)) {
    return NextResponse.json({ ok: false, error: "Invalid Orb slug" }, { status: 400 });
  }
  if (!winnerStoreConfigured()) {
    return NextResponse.json({ ok: true, configured: false, winner: null });
  }
  return NextResponse.json({ ok: true, configured: true, winner: await getWinner(slug) });
}
