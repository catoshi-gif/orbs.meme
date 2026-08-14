import { NextResponse } from "next/server";
import { verifyEligibility } from "@/lib/eligibility";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as { wallet?: unknown; birthDate?: unknown; signature?: unknown };
  if (typeof body.wallet !== "string" || typeof body.birthDate !== "string" || typeof body.signature !== "string") {
    return NextResponse.json({ ok: false, error: "Invalid eligibility verification request" }, { status: 400 });
  }
  try {
    const result = await verifyEligibility(body.wallet, body.birthDate, body.signature);
    if (!result.eligible) {
      return NextResponse.json({ ok: false, eligible: false, error: "You must be at least 18 years old to create or enter an Orb." }, { status: 403 });
    }
    return NextResponse.json({ ok: true, eligible: true }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Eligibility verification failed" }, { status: 400 });
  }
}
