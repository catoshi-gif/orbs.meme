import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { getPublicOrb } from "@/lib/orbStore";
import { getShareProof, hasFollowProof, hasWalletProof, storeShareProof } from "@/lib/qualification";
import { hasHumanProof } from "@/lib/turnstile";
import { getCurrentXSession, getRecentXPostsForCurrentSession } from "@/lib/xAuth";
import { redisCommand } from "@/lib/upstash";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function normalizeWallet(value: unknown) {
  if (typeof value !== "string") return null;
  try { return new PublicKey(value).toBase58(); } catch { return null; }
}

function siteHostname() {
  try { return new URL(process.env.NEXT_PUBLIC_SITE_URL || "https://orbs.meme").hostname.toLowerCase().replace(/^www\./, ""); }
  catch { return "orbs.meme"; }
}

function isOrbUrl(value: string, slug: string) {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    return url.protocol === "https:" && hostname === siteHostname() && url.pathname.replace(/\/+$/, "") === `/orb/${slug}`;
  } catch { return false; }
}

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const wallet = normalizeWallet(new URL(request.url).searchParams.get("wallet"));
  const x = await getCurrentXSession();
  if (!x || !wallet) return NextResponse.json({ ok: true, verified: false });
  const proof = await getShareProof(slug, x.user.id, wallet);
  return NextResponse.json({
    ok: true,
    verified: Boolean(proof),
    postUrl: proof ? `https://x.com/${encodeURIComponent(x.user.username)}/status/${proof.postId}` : null,
  }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const body = await request.json().catch(() => ({})) as { wallet?: unknown; originalLine?: unknown };
  const wallet = normalizeWallet(body.wallet);
  const originalLine = typeof body.originalLine === "string" ? body.originalLine.trim().replace(/\s+/g, " ") : "";
  if (!wallet) return NextResponse.json({ ok: false, error: "Invalid wallet" }, { status: 400 });

  const [orb, x] = await Promise.all([getPublicOrb(slug), getCurrentXSession()]);
  if (!orb) return NextResponse.json({ ok: false, error: "Orb not found" }, { status: 404 });
  if (!x) return NextResponse.json({ ok: false, error: "Connect X first" }, { status: 401 });

  const existing = await getShareProof(slug, x.user.id, wallet);
  if (existing) return NextResponse.json({ ok: true, verified: true, postUrl: `https://x.com/${encodeURIComponent(x.user.username)}/status/${existing.postId}` });
  if (originalLine.length < 12 || originalLine.length > 70) return NextResponse.json({ ok: false, error: "Use the same original line you added before opening the X composer." }, { status: 400 });

  const [followed, walletVerified, humanVerified] = await Promise.all([
    hasFollowProof(x.user.id, orb.hostX.id),
    hasWalletProof(slug, x.user.id, wallet),
    hasHumanProof(slug, x.user.id, wallet),
  ]);
  if (!followed || !walletVerified || !humanVerified) {
    return NextResponse.json({ ok: false, error: "Complete the earlier qualification steps first" }, { status: 403 });
  }

  const minute = Math.floor(Date.now() / 60_000);
  const rateKey = `orbs:v1:rl:x-share-verify:${x.user.id}:${minute}`;
  const count = Number(await redisCommand<number>(["INCR", rateKey]) || 0);
  if (count === 1) await redisCommand(["EXPIRE", rateKey, 70]);
  if (count > 4) return NextResponse.json({ ok: false, error: "Too many verification attempts. Wait a minute, then try again." }, { status: 429 });

  try {
    const { posts } = await getRecentXPostsForCurrentSession(5);
    const expectedLine = originalLine.toLocaleLowerCase();
    const match = posts.find((post) => post.createdAt >= orb.createdAt - 5 * 60_000 && post.text.replace(/\s+/g, " ").toLocaleLowerCase().includes(expectedLine) && post.urls.some((url) => isOrbUrl(url, slug)));
    if (!match) return NextResponse.json({ ok: false, verified: false, error: "No recent post from this X account contains the exact Orb link yet. Publish it, wait a few seconds, then verify again." }, { status: 422 });
    const ttl = Math.max(60 * 60 * 24 * 2, Math.ceil((orb.startsAt - Date.now()) / 1000) + 60 * 60 * 24 * 2);
    await storeShareProof(slug, x.user.id, wallet, { postId: match.id, postCreatedAt: match.createdAt, confirmedAt: Date.now() }, ttl);
    return NextResponse.json({ ok: true, verified: true, postUrl: `https://x.com/${encodeURIComponent(x.user.username)}/status/${match.id}` });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not verify the X post";
    return NextResponse.json({ ok: false, error: message }, { status: message === "X_NOT_CONNECTED" ? 401 : 502 });
  }
}
