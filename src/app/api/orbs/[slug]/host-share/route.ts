import { NextResponse } from "next/server";
import { getOrbRecord, recordHostSharePost } from "@/lib/orbStore";
import { getCurrentXSession, getRecentXPostsForCurrentSession, XApiRequestError } from "@/lib/xAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isOrbUrl(value: string, slug: string) {
  try {
    const url = new URL(value);
    return url.pathname.replace(/\/+$/, "") === `/orb/${slug}`;
  } catch {
    return false;
  }
}

export async function GET(_request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  const orb = await getOrbRecord(slug);
  const x = await getCurrentXSession();
  if (!orb || !x || x.user.id !== orb.hostX.id) return NextResponse.json({ ok: true, verified: false });
  return NextResponse.json({
    ok: true,
    verified: Boolean(orb.hostSharePostId),
    postUrl: orb.hostSharePostId ? `https://x.com/${encodeURIComponent(orb.hostX.username)}/status/${orb.hostSharePostId}` : null,
  });
}

export async function POST(_request: Request, context: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await context.params;
    const orb = await getOrbRecord(slug);
    if (!orb) return NextResponse.json({ ok: false, error: "Orb not found" }, { status: 404 });
    const x = await getCurrentXSession();
    if (!x) return NextResponse.json({ ok: false, error: "Reconnect X, then verify the creator post." }, { status: 401 });
    if (x.user.id !== orb.hostX.id) return NextResponse.json({ ok: false, error: "Connect the X account that created this Orb." }, { status: 403 });
    if (orb.hostSharePostId) return NextResponse.json({ ok: true, verified: true, postUrl: `https://x.com/${encodeURIComponent(orb.hostX.username)}/status/${orb.hostSharePostId}` });

    const { posts } = await getRecentXPostsForCurrentSession(10);
    const match = posts.find((post) =>
      post.createdAt >= orb.createdAt - 5 * 60_000 &&
      post.urls.some((url) => isOrbUrl(url, slug))
    );
    if (!match) return NextResponse.json({ ok: false, verified: false, error: "No recent post from the host X account contains this Orb link yet. Post it, wait a few seconds, then verify." }, { status: 422 });

    await recordHostSharePost(slug, x.user.id, match.id, match.createdAt);
    return NextResponse.json({ ok: true, verified: true, postUrl: `https://x.com/${encodeURIComponent(x.user.username)}/status/${match.id}` });
  } catch (error) {
    if (error instanceof XApiRequestError) {
      const status = error.code === "X_RECONNECT_REQUIRED" ? 401 : error.code === "X_RATE_LIMITED" ? 429 : 503;
      return NextResponse.json({ ok: false, error: error.message }, { status });
    }
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Could not verify creator X post" }, { status: 503 });
  }
}
