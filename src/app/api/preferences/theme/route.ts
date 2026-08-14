import { NextRequest, NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { redisCommand, upstashConfigured } from "@/lib/upstash";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const THEME_TTL_SECONDS = 60 * 60 * 24 * 365;

function cleanWallet(value: string | null) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  try {
    return new PublicKey(raw).toBase58();
  } catch {
    return null;
  }
}

function themeKey(wallet: string) {
  return `orbs:v1:pref:theme:${wallet}`;
}

export async function GET(request: NextRequest) {
  const wallet = cleanWallet(request.nextUrl.searchParams.get("wallet"));
  if (!wallet) return NextResponse.json({ ok: false, error: "Invalid wallet" }, { status: 400 });
  if (!upstashConfigured()) return NextResponse.json({ ok: true, theme: null });

  const value = await redisCommand<string>(["GET", themeKey(wallet)]);
  const theme = value === "light" || value === "dark" ? value : null;
  return NextResponse.json({ ok: true, theme });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as { wallet?: unknown; theme?: unknown } | null;
  const wallet = cleanWallet(typeof body?.wallet === "string" ? body.wallet : null);
  const theme = body?.theme === "light" || body?.theme === "dark" ? body.theme : null;

  if (!wallet || !theme) {
    return NextResponse.json({ ok: false, error: "Invalid theme preference" }, { status: 400 });
  }
  if (upstashConfigured()) {
    await redisCommand<string>(["SET", themeKey(wallet), theme, "EX", THEME_TTL_SECONDS]);
  }
  return NextResponse.json({ ok: true });
}
