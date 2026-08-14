import { NextResponse } from "next/server";
import { createEligibilityChallenge, hasEligibilityReceipt } from "@/lib/eligibility";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as { wallet?: unknown };
  if (typeof body.wallet !== "string") return NextResponse.json({ ok: false, error: "Invalid wallet" }, { status: 400 });
  try {
    if (await hasEligibilityReceipt(body.wallet)) return NextResponse.json({ ok: true, alreadyConfirmed: true });
    const challenge = await createEligibilityChallenge(body.wallet);
    return NextResponse.json({ ok: true, ...challenge }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Eligibility verification unavailable" }, { status: 503 });
  }
}
