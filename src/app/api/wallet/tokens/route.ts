import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { getWalletSplTokens } from "@/lib/walletTokens";
import { issuePrizeQuote } from "@/lib/prizeQuote";
import { redisCommand, upstashConfigured } from "@/lib/upstash";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;

function clientIp(request: Request) {
  return (request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || "unknown").split(",")[0]!.trim();
}

async function rateLimit(request: Request) {
  if (!upstashConfigured()) return true;
  const minute = Math.floor(Date.now() / 60_000);
  const key = `orbs:v1:rl:wallet-tokens:${clientIp(request)}:${minute}`;
  const count = Number(await redisCommand<number>(["INCR", key]) || 0);
  if (count === 1) await redisCommand(["EXPIRE", key, 70]);
  return count <= 30;
}

export async function GET(request: Request) {
  if (!(await rateLimit(request))) return NextResponse.json({ ok: false, error: "Too many wallet refreshes" }, { status: 429 });
  const wallet = new URL(request.url).searchParams.get("wallet")?.trim() || "";
  try { new PublicKey(wallet); } catch { return NextResponse.json({ ok: false, error: "Invalid Solana wallet" }, { status: 400 }); }
  try {
    const tokens = (await getWalletSplTokens(wallet)).map((token) => ({
      ...token,
      prizeQuote: token.eligible && token.usdPrice
        ? issuePrizeQuote({ wallet, mint: token.mint, decimals: token.decimals, usdPrice: token.usdPrice })
        : null,
    }));
    return NextResponse.json({ ok: true, wallet, tokens, source: "classic-spl+jupiter-v3+signed-prize-quote", updatedAt: Date.now() }, {
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Could not load wallet tokens" }, { status: 502 });
  }
}
