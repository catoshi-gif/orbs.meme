import { NextResponse } from "next/server";
import { followXUser, getCurrentXSession } from "@/lib/xAuth";
import { redisCommand, redisGetJson, redisSetJson } from "@/lib/upstash";
import { followProofKey } from "@/lib/qualification";
import { getPublicOrb } from "@/lib/orbStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function cleanSlug(value: unknown) {
  if (typeof value !== "string") return null;
  const slug = value.trim();
  return slug && slug.length <= 96 && /^[A-Za-z0-9_-]+$/.test(slug) ? slug : null;
}

async function contextFor(slug: string) {
  const [session, orb] = await Promise.all([getCurrentXSession(), getPublicOrb(slug)]);
  return { session, orb };
}

export async function GET(request: Request) {
  const slug = cleanSlug(new URL(request.url).searchParams.get("slug"));
  if (!slug) return NextResponse.json({ ok: false, error: "Invalid Orb" }, { status: 400 });
  const { session, orb } = await contextFor(slug);
  if (!orb) return NextResponse.json({ ok: false, error: "Orb not found" }, { status: 404 });
  if (!session) return NextResponse.json({ ok: true, connected: false, confirmed: false });
  if (session.user.id === orb.hostX.id) return NextResponse.json({ ok: true, connected: true, confirmed: true, self: true });
  const proof = await redisGetJson<{ confirmedAt: number }>(followProofKey(session.user.id, orb.hostX.id));
  return NextResponse.json({ ok: true, connected: true, confirmed: Boolean(proof), confirmedAt: proof?.confirmedAt || null });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as { slug?: unknown };
  const slug = cleanSlug(body.slug);
  if (!slug) return NextResponse.json({ ok: false, error: "Invalid Orb" }, { status: 400 });
  const { session, orb } = await contextFor(slug);
  if (!orb) return NextResponse.json({ ok: false, error: "Orb not found" }, { status: 404 });
  if (!session) return NextResponse.json({ ok: false, error: "X_NOT_CONNECTED" }, { status: 401 });
  if (session.user.id === orb.hostX.id) return NextResponse.json({ ok: true, following: true, pending: false, confirmed: true, self: true });

  const proofKey = followProofKey(session.user.id, orb.hostX.id);
  const existing = await redisGetJson<{ confirmedAt: number }>(proofKey);
  if (existing) return NextResponse.json({ ok: true, following: true, pending: false, confirmed: true, cached: true });

  // Cost guard: never let a modified client turn the Orbs endpoint into an unbounded X write proxy.
  const minute = Math.floor(Date.now() / 60_000);
  const rateKey = `orbs:v1:rl:x-follow:${session.user.id}:${minute}`;
  const count = Number(await redisCommand<number>(["INCR", rateKey]) || 0);
  if (count === 1) await redisCommand(["EXPIRE", rateKey, 70]);
  if (count > 5) return NextResponse.json({ ok: false, error: "Too many X follow attempts. Try again shortly." }, { status: 429 });

  try {
    const result = await followXUser(orb.hostX.id);
    if (result.following && !result.pending) await redisSetJson(proofKey, { confirmedAt: Date.now() }, { exSeconds: 60 * 60 * 24 * 30 });
    return NextResponse.json({ ok: true, ...result, confirmed: result.following && !result.pending });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not follow host";
    return NextResponse.json({ ok: false, error: message }, { status: message === "X_NOT_CONNECTED" ? 401 : 502 });
  }
}
