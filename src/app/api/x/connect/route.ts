import { NextResponse } from "next/server";
import { createXAuthorizeUrl, xConfigured } from "@/lib/xAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!xConfigured()) return NextResponse.json({ ok: false, error: "X OAuth is not configured" }, { status: 503 });
  const returnTo = new URL(request.url).searchParams.get("returnTo") || "/";
  try {
    return NextResponse.redirect(await createXAuthorizeUrl(returnTo));
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Could not start X OAuth" }, { status: 500 });
  }
}
