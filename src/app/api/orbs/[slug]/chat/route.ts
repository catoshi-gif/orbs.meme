import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { getPublicOrb } from "@/lib/orbStore";
import { hasShareProof } from "@/lib/qualification";
import { redisCommand, upstashConfigured } from "@/lib/upstash";
import { getCurrentXSession } from "@/lib/xAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RATE_SECONDS = 30;
const CHAT_TTL_SECONDS = 60 * 60 * 48;
const MAX_MESSAGES = 30;
const MAX_MESSAGE_CHARS = 180;

function chatKey(slug: string) { return `orbs:v1:waiting-chat:${slug}`; }
function rateKey(slug: string, xId: string, wallet: string) { return `orbs:v1:waiting-chat-rate:${slug}:${xId}:${wallet}`; }

function normalizeWallet(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  try { return new PublicKey(value).toBase58(); } catch { return null; }
}

function cleanMessage(value: unknown) {
  if (typeof value !== "string") return "";
  const cleaned = Array.from(value.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim()).slice(0, MAX_MESSAGE_CHARS).join("");
  if (/https?:\/\/|www\./i.test(cleaned)) return "";
  return cleaned;
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

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const orb = await getPublicOrb(slug);
  if (!orb) return NextResponse.json({ ok: false, error: "Orb not found" }, { status: 404 });
  if (!upstashConfigured()) return NextResponse.json({ ok: false, error: "Waiting-room chat is temporarily unavailable" }, { status: 503 });

  const body = await request.json().catch(() => ({})) as { wallet?: unknown; text?: unknown };
  const wallet = normalizeWallet(body.wallet);
  const text = cleanMessage(body.text);
  if (!wallet) return NextResponse.json({ ok: false, error: "Connect your verified wallet first" }, { status: 400 });
  if (!text) return NextResponse.json({ ok: false, error: "Keep chat messages under 180 characters and do not include links" }, { status: 400 });

  const x = await getCurrentXSession().catch(() => null);
  if (!x) return NextResponse.json({ ok: false, error: "Connect your verified X account first" }, { status: 401 });
  const registered = await hasShareProof(slug, x.user.id, wallet).catch(() => false);
  if (!registered) return NextResponse.json({ ok: false, error: "Finish registration before chatting" }, { status: 403 });

  const sentAt = Date.now();
  const message = JSON.stringify({
    id: randomBytes(12).toString("base64url"),
    username: x.user.username,
    profileImageUrl: x.user.profileImageUrl,
    text,
    sentAt,
  });

  const result = await redisCommand<unknown[]>([
    "EVAL",
    `
      if redis.call('EXISTS', KEYS[1]) == 1 then
        local ttl = redis.call('TTL', KEYS[1])
        return { 'RATE', ttl }
      end
      redis.call('SET', KEYS[1], '1', 'EX', ARGV[1])
      redis.call('ZADD', KEYS[2], ARGV[2], ARGV[3])
      local count = redis.call('ZCARD', KEYS[2])
      if count > tonumber(ARGV[4]) then
        redis.call('ZREMRANGEBYRANK', KEYS[2], 0, count - tonumber(ARGV[4]) - 1)
      end
      redis.call('EXPIRE', KEYS[2], ARGV[5])
      return { 'OK', redis.call('ZRANGE', KEYS[2], -tonumber(ARGV[4]), -1) }
    `,
    "2",
    rateKey(slug, x.user.id, wallet),
    chatKey(slug),
    String(RATE_SECONDS),
    String(sentAt),
    message,
    String(MAX_MESSAGES),
    String(CHAT_TTL_SECONDS),
  ]);

  if (result?.[0] === "RATE") {
    const retryAfter = Math.max(1, Number(result?.[1] || RATE_SECONDS));
    return NextResponse.json({ ok: false, error: `Slow down. You can chat again in ${retryAfter}s.`, retryAfter }, { status: 429 });
  }
  if (result?.[0] !== "OK") return NextResponse.json({ ok: false, error: "Could not send chat message" }, { status: 503 });
  return NextResponse.json({ ok: true, messages: parseMessages(result[1]), cooldownSeconds: RATE_SECONDS }, { headers: { "Cache-Control": "private, no-store" } });
}
