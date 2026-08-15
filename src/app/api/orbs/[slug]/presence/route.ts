import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { getPublicOrb } from "@/lib/orbStore";
import { hasShareProof } from "@/lib/qualification";
import { redisCommand, upstashConfigured } from "@/lib/upstash";
import { getCurrentXSession } from "@/lib/xAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PRESENCE_COOKIE = "orbs_waiting_presence";
const ACTIVE_WINDOW_MS = 90_000;
const KEY_TTL_SECONDS = 15 * 60;

function allKey(slug: string) { return `orbs:v1:presence:${slug}:all`; }
function registeredKey(slug: string) { return `orbs:v1:presence:${slug}:registered`; }
function chatKey(slug: string) { return `orbs:v1:waiting-chat:${slug}`; }

function normalizeWallet(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  try { return new PublicKey(value).toBase58(); } catch { return null; }
}

function parseMessages(raw: unknown) {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((value) => {
    if (typeof value !== "string") return [];
    try {
      const row = JSON.parse(value) as { id?: string; username?: string; profileImageUrl?: string; text?: string; sentAt?: number };
      if (!row.id || !row.username || !row.text || !Number.isFinite(row.sentAt)) return [];
      return [{ id: row.id, username: row.username, profileImageUrl: row.profileImageUrl || undefined, text: row.text, sentAt: Number(row.sentAt) }];
    } catch { return []; }
  });
}

async function counts(slug: string, visitorId: string, registered: boolean, leave: boolean) {
  const now = Date.now();
  const result = await redisCommand<unknown[]>([
    "EVAL",
    `
      local cutoff = tonumber(ARGV[1])
      redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', cutoff)
      redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', cutoff)

      if ARGV[4] == '1' then
        redis.call('ZREM', KEYS[1], ARGV[2])
        redis.call('ZREM', KEYS[2], ARGV[2])
      else
        redis.call('ZADD', KEYS[1], ARGV[3], ARGV[2])
        if ARGV[5] == '1' then
          redis.call('ZADD', KEYS[2], ARGV[3], ARGV[2])
        else
          redis.call('ZREM', KEYS[2], ARGV[2])
        end
        redis.call('EXPIRE', KEYS[1], ARGV[6])
        redis.call('EXPIRE', KEYS[2], ARGV[6])
      end

      return { redis.call('ZCARD', KEYS[1]), redis.call('ZCARD', KEYS[2]), redis.call('ZRANGE', KEYS[3], -20, -1) }
    `,
    "3",
    allKey(slug),
    registeredKey(slug),
    chatKey(slug),
    String(now - ACTIVE_WINDOW_MS),
    visitorId,
    String(now),
    leave ? "1" : "0",
    registered ? "1" : "0",
    String(KEY_TTL_SECONDS),
  ]);
  const total = Math.max(0, Number(result?.[0] || 0));
  const registeredCount = Math.min(total, Math.max(0, Number(result?.[1] || 0)));
  return { total, registered: registeredCount, unregistered: Math.max(0, total - registeredCount), messages: parseMessages(result?.[2]) };
}

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const orb = await getPublicOrb(slug);
  if (!orb) return NextResponse.json({ ok: false, error: "Orb not found" }, { status: 404 });
  if (!upstashConfigured()) return NextResponse.json({ ok: true, available: false, total: 0, registered: 0, unregistered: 0, messages: [], canChat: false });

  const body = await request.json().catch(() => ({})) as { wallet?: unknown; leave?: unknown };
  const wallet = normalizeWallet(body.wallet);
  const leave = body.leave === true;
  const jar = await cookies();
  let visitorId = jar.get(PRESENCE_COOKIE)?.value || "";
  let freshVisitor = false;
  if (!/^[A-Za-z0-9_-]{24,80}$/.test(visitorId)) {
    visitorId = randomBytes(24).toString("base64url");
    freshVisitor = true;
  }

  let registered = false;
  if (!leave && wallet) {
    const x = await getCurrentXSession().catch(() => null);
    if (x) registered = await hasShareProof(slug, x.user.id, wallet).catch(() => false);
  }

  const current = await counts(slug, visitorId, registered, leave);
  const response = NextResponse.json({ ok: true, available: true, ...current, canChat: registered }, {
    headers: { "Cache-Control": "private, no-store" },
  });
  if (freshVisitor) {
    response.cookies.set(PRESENCE_COOKIE, visitorId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
  }
  return response;
}
