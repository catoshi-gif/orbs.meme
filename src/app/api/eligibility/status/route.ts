import { NextResponse } from "next/server";
import { hasEligibilityReceipt } from "@/lib/eligibility";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const wallet = new URL(request.url).searchParams.get("wallet") || "";
  try {
    return NextResponse.json({ ok: true, confirmed: await hasEligibilityReceipt(wallet) }, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch {
    return NextResponse.json({ ok: false, confirmed: false, error: "Eligibility verification unavailable" }, { status: 503 });
  }
}
