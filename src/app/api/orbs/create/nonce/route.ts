import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { createHostAuthorizationChallenge } from "@/lib/hostAuthorization";
import { getCurrentXSession } from "@/lib/xAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const x = await getCurrentXSession();
  if (!x) return NextResponse.json({ ok: false, error: "Connect X before creating an Orb" }, { status: 401 });
  const body = await request.json().catch(() => ({})) as { wallet?: unknown };
  if (typeof body.wallet !== "string") return NextResponse.json({ ok: false, error: "Invalid wallet" }, { status: 400 });
  let wallet: string;
  try { wallet = new PublicKey(body.wallet).toBase58(); }
  catch { return NextResponse.json({ ok: false, error: "Invalid wallet" }, { status: 400 }); }
  try {
    const challenge = await createHostAuthorizationChallenge(wallet, x.user.id);
    return NextResponse.json({ ok: true, ...challenge }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("[orbs:host-authorization] Could not store creator challenge", error);
    return NextResponse.json({ ok: false, error: "Creator authorization is temporarily unavailable" }, { status: 503 });
  }
}
