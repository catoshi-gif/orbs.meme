import { NextResponse } from "next/server";
import { getCurrentXSession, revokeCurrentXSession, xConfigured } from "@/lib/xAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!xConfigured()) return NextResponse.json({ ok: true, configured: false, connected: false, user: null });
  const session = await getCurrentXSession();
  return NextResponse.json({ ok: true, configured: true, connected: Boolean(session), user: session?.user || null }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function DELETE() {
  await revokeCurrentXSession();
  return NextResponse.json({ ok: true });
}
