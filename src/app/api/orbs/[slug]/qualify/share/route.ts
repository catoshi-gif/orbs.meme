import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { getPublicOrb } from "@/lib/orbStore";
import { clearShareIntent, getShareIntent, getShareProof, hasFollowProof, hasWalletProof, indexEnteredOrb, storeShareIntent, storeShareProof } from "@/lib/qualification";
import { hasHumanProof } from "@/lib/turnstile";
import { getCurrentXSession, getRecentXPostsForCurrentSession, XApiRequestError } from "@/lib/xAuth";
import { redisCommand } from "@/lib/upstash";
import { ORB_HISTORY_TTL_SECONDS, orbEndsAt } from "@/lib/orbLifecycle";
import { getWinner } from "@/lib/upstashWinner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

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
  if (proof) {
    try { await indexEnteredOrb(slug, wallet, proof.confirmedAt); }
    catch (error) { console.warn("[orbs:entry-index] Could not backfill entrant activity", error); }
  }
  return NextResponse.json({
    ok: true,
    verified: Boolean(proof),
    postUrl: proof ? `https://x.com/${encodeURIComponent(x.user.username)}/status/${proof.postId}` : null,
  }, { headers: { "Cache-Control": "private, no-store" } });
}


async function qualificationReady(slug: string, wallet: string, xUserId: string, hostXId: string) {
  const [followed, walletVerified, humanVerified] = await Promise.all([
    hasFollowProof(xUserId, hostXId),
    hasWalletProof(slug, xUserId, wallet),
    hasHumanProof(slug, xUserId, wallet),
  ]);
  return followed && walletVerified && humanVerified;
}

function findMatchingEntryPost(
  posts: Awaited<ReturnType<typeof getRecentXPostsForCurrentSession>>["posts"],
  slug: string,
  originalLine: string,
  notBefore: number,
  allowStandardizedRecovery = false,
) {
  const expectedLine = originalLine.replace(/\s+/g, " ").toLocaleLowerCase();
  return posts.find((post) => {
    if (post.createdAt < notBefore || !post.urls.some((url) => isOrbUrl(url, slug))) return false;
    const normalized = post.text.replace(/\s+/g, " ").toLocaleLowerCase();
    if (expectedLine && normalized.includes(expectedLine)) return true;
    // Recovery fallback for iOS webviews that were suspended before the tiny
    // share-intent write completed. This still requires a post authored by the
    // connected X account, the exact Orb URL and the standardized contest copy.
    return allowStandardizedRecovery &&
      normalized.includes("#contest") &&
      normalized.includes("first verified finish wins");
  });
}

async function saveVerifiedShare(
  slug: string,
  wallet: string,
  x: NonNullable<Awaited<ReturnType<typeof getCurrentXSession>>>,
  orb: NonNullable<Awaited<ReturnType<typeof getPublicOrb>>>,
  post: Awaited<ReturnType<typeof getRecentXPostsForCurrentSession>>["posts"][number],
) {
  const ttl = Math.max(60 * 60 * 24 * 2, Math.ceil((orbEndsAt(orb) - Date.now()) / 1000) + 60 * 60 * 24 * 2);
  const activityTtl = Math.max(ORB_HISTORY_TTL_SECONDS, Math.ceil((orbEndsAt(orb) - Date.now()) / 1000) + ORB_HISTORY_TTL_SECONDS);
  await storeShareProof(slug, x.user.id, wallet, { postId: post.id, postCreatedAt: post.createdAt, confirmedAt: Date.now() }, ttl, activityTtl);
  await clearShareIntent(slug, x.user.id, wallet);
  return NextResponse.json({
    ok: true,
    verified: true,
    postUrl: `https://x.com/${encodeURIComponent(x.user.username)}/status/${post.id}`,
  });
}

async function verifySharePost(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const body = await request.json().catch(() => ({})) as { wallet?: unknown; originalLine?: unknown; mode?: unknown };
  const wallet = normalizeWallet(body.wallet);
  const originalLine = typeof body.originalLine === "string" ? body.originalLine.trim().replace(/\s+/g, " ") : "";
  const mode = body.mode === "intent" || body.mode === "recover" ? body.mode : "verify";
  if (!wallet) return NextResponse.json({ ok: false, error: "Invalid wallet" }, { status: 400 });

  const [orb, x] = await Promise.all([getPublicOrb(slug), getCurrentXSession()]);
  if (!orb) return NextResponse.json({ ok: false, error: "Orb not found" }, { status: 404 });
  if (!x) return NextResponse.json({ ok: false, error: "Connect X first" }, { status: 401 });

  const existing = await getShareProof(slug, x.user.id, wallet);
  if (existing) {
    try { await indexEnteredOrb(slug, wallet, existing.confirmedAt); }
    catch (error) { console.warn("[orbs:entry-index] Could not backfill entrant activity", error); }
    return NextResponse.json({ ok: true, verified: true, postUrl: `https://x.com/${encodeURIComponent(x.user.username)}/status/${existing.postId}` });
  }
  if (Date.now() >= orbEndsAt(orb) || await getWinner(orb.id)) {
    return NextResponse.json({ ok: false, error: "This Orb is already closed. New entries are no longer accepted." }, { status: 409 });
  }

  if (!await qualificationReady(slug, wallet, x.user.id, orb.hostX.id)) {
    return NextResponse.json({ ok: false, error: "Complete the earlier qualification steps first" }, { status: 403 });
  }

  if (mode === "intent") {
    if (originalLine.length < 12 || originalLine.length > 70) {
      return NextResponse.json({ ok: false, error: "Add one original line before opening X." }, { status: 400 });
    }
    await storeShareIntent(slug, x.user.id, wallet, { originalLine, startedAt: Date.now() });
    return NextResponse.json({ ok: true, pending: true }, { headers: { "Cache-Control": "private, no-store" } });
  }

  let verificationLine = originalLine;
  let notBefore = orb.createdAt - 5 * 60_000;

  let pendingIntent = null as Awaited<ReturnType<typeof getShareIntent>>;
  if (mode === "recover") {
    pendingIntent = await getShareIntent(slug, x.user.id, wallet);
    if (pendingIntent) {
      verificationLine = pendingIntent.originalLine;
      notBefore = Math.max(notBefore, pendingIntent.startedAt - 2 * 60_000);
    }
    // If an iOS wallet/dApp browser suspended Orbs before the intent write
    // completed, manual recovery is still allowed to inspect this connected
    // account's recent authored posts. Matching remains Orb-specific below.
  } else if (verificationLine.length < 12 || verificationLine.length > 70) {
    return NextResponse.json({ ok: false, error: "Use the same original line you added before opening the X composer." }, { status: 400 });
  }

  const minute = Math.floor(Date.now() / 60_000);
  const rateKey = `orbs:v1:rl:x-share-verify:${x.user.id}:${minute}`;
  const count = Number(await redisCommand<number>(["INCR", rateKey]) || 0);
  if (count === 1) await redisCommand(["EXPIRE", rateKey, 70]);
  if (count > 4) return NextResponse.json({ ok: false, error: "Too many verification attempts. Wait a minute, then try again." }, { status: 429 });

  const { posts } = await getRecentXPostsForCurrentSession(mode === "recover" ? 10 : 5);
  const match = findMatchingEntryPost(posts, slug, verificationLine, notBefore, mode === "recover");
  if (!match) {
    return NextResponse.json({
      ok: true,
      verified: false,
      pending: mode === "recover",
      error: mode === "recover"
        ? "Your X post is not visible to Orbs yet. If you just posted it, wait a few seconds and check again."
        : "No recent post from this X account contains the exact Orb link yet. Publish it, wait a few seconds, then verify again.",
    }, { status: mode === "recover" ? 200 : 422, headers: { "Cache-Control": "private, no-store" } });
  }
  return saveVerifiedShare(slug, wallet, x, orb, match);
}

export async function POST(request: Request, context: { params: Promise<{ slug: string }> }) {
  try {
    return await verifySharePost(request, context);
  } catch (error) {
    if (error instanceof XApiRequestError) {
      const status = error.code === "X_RECONNECT_REQUIRED" ? 401 : error.code === "X_RATE_LIMITED" ? 429 : 503;
      const headers: Record<string, string> = { "Cache-Control": "private, no-store" };
      if (error.retryAfterSeconds) headers["Retry-After"] = String(error.retryAfterSeconds);
      return NextResponse.json({ ok: false, error: error.message, code: error.code }, { status, headers });
    }
    const message = error instanceof Error ? error.message : "Could not verify the X post";
    if (message === "X_NOT_CONNECTED") {
      return NextResponse.json({ ok: false, error: "Your X connection expired. Reconnect X, then try verification again.", code: "X_RECONNECT_REQUIRED" }, { status: 401, headers: { "Cache-Control": "private, no-store" } });
    }
    console.error("[orbs:x:share-verification] Unexpected verification failure", error);
    return NextResponse.json({ ok: false, error: "Post verification is temporarily unavailable. Your post is safe; wait a moment, then try again.", code: "POST_VERIFICATION_UNAVAILABLE" }, { status: 503, headers: { "Cache-Control": "private, no-store", "Retry-After": "15" } });
  }
}
