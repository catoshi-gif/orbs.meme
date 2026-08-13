import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { getPublicOrb } from "@/lib/orbStore";
import { hasFollowProof, hasWalletProof } from "@/lib/qualification";
import { getCurrentXSession } from "@/lib/xAuth";
import { hasHumanProof, turnstileConfigured, verifyAndStoreHumanProof } from "@/lib/turnstile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function clientIp(request: Request) {
  return request.headers.get("cf-connecting-ip") || request.headers.get("x-real-ip") || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
}

function normalizeWallet(value: unknown) {
  if (typeof value !== "string") return null;
  try { return new PublicKey(value).toBase58(); } catch { return null; }
}

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const wallet = normalizeWallet(new URL(request.url).searchParams.get("wallet"));
  const x = await getCurrentXSession();
  if (!x || !wallet) return NextResponse.json({ ok: true, configured: turnstileConfigured(), verified: false });
  return NextResponse.json({ ok: true, configured: turnstileConfigured(), verified: await hasHumanProof(slug, x.user.id, wallet) });
}

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [orb, x] = await Promise.all([getPublicOrb(slug), getCurrentXSession()]);
  if (!orb) return NextResponse.json({ ok: false, error: "Orb not found" }, { status: 404 });
  if (!x) return NextResponse.json({ ok: false, error: "Connect X first" }, { status: 401 });
  if (!turnstileConfigured()) return NextResponse.json({ ok: false, error: "Turnstile is not configured" }, { status: 503 });

  const body = await request.json().catch(() => ({})) as { wallet?: unknown; token?: unknown };
  const wallet = normalizeWallet(body.wallet);
  const token = typeof body.token === "string" ? body.token : "";
  if (!wallet) return NextResponse.json({ ok: false, error: "Invalid wallet" }, { status: 400 });

  const [followed, walletVerified] = await Promise.all([
    hasFollowProof(x.user.id, orb.hostX.id),
    hasWalletProof(slug, x.user.id, wallet),
  ]);
  if (!followed) return NextResponse.json({ ok: false, error: "Follow the host first" }, { status: 403 });
  if (!walletVerified) return NextResponse.json({ ok: false, error: "Verify your wallet first" }, { status: 403 });

  try {
    const verified = await verifyAndStoreHumanProof({ slug, xUserId: x.user.id, wallet, token, remoteIp: clientIp(request) });
    return NextResponse.json({ ok: verified, verified }, { status: verified ? 200 : 422 });
  } catch (error) {
    return NextResponse.json({ ok: false, verified: false, error: error instanceof Error ? error.message : "Human verification failed" }, { status: 502 });
  }
}
