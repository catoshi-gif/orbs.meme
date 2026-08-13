import { NextResponse } from "next/server";
import { finishXOAuth, setXSessionCookie } from "@/lib/xAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const error = url.searchParams.get("error");
  const state = url.searchParams.get("state") || "";
  const code = url.searchParams.get("code") || "";
  if (error) return NextResponse.redirect(new URL(`/?x_error=${encodeURIComponent(error)}`, url.origin));
  if (!state || !code) return NextResponse.redirect(new URL("/?x_error=missing_callback", url.origin));
  try {
    const result = await finishXOAuth(state, code);
    await setXSessionCookie(result.sessionId);
    const destination = new URL(result.returnTo, url.origin);
    destination.searchParams.set("x_connected", "1");
    return NextResponse.redirect(destination);
  } catch (err) {
    const destination = new URL("/", url.origin);
    destination.searchParams.set("x_error", err instanceof Error ? err.message.slice(0, 100) : "oauth_failed");
    return NextResponse.redirect(destination);
  }
}
