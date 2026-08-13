import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { createTestOrb } from "@/lib/orbStore";
import { getWalletSplTokens } from "@/lib/walletTokens";
import { getCurrentXSession } from "@/lib/xAuth";
import { normalizeDifficulty } from "@/game/maze";
import { DEFAULT_GAME_STYLE } from "@/game/constants";
import { safeColor } from "@/game/theme";
import type { GameStyle } from "@/game/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;

type Body = { hostWallet?: unknown; mint?: unknown; prizeTokenAmount?: unknown; difficulty?: unknown; style?: Partial<Record<keyof GameStyle, unknown>>; startsAt?: unknown };

export async function POST(request: Request) {
  const x = await getCurrentXSession();
  if (!x) return NextResponse.json({ ok: false, error: "Connect X before creating an Orb" }, { status: 401 });
  if (x.user.protected) return NextResponse.json({ ok: false, error: "Orb hosts must use a public X account" }, { status: 400 });
  let body: Body;
  try { body = await request.json(); } catch { return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 }); }
  const hostWallet = typeof body.hostWallet === "string" ? body.hostWallet.trim() : "";
  try { new PublicKey(hostWallet); } catch { return NextResponse.json({ ok: false, error: "Invalid host wallet" }, { status: 400 }); }
  const mint = typeof body.mint === "string" ? body.mint.trim() : "";
  const prizeTokenAmount = Number(body.prizeTokenAmount);
  const startsAt = Number(body.startsAt);
  const style: GameStyle = {
    marble: safeColor(typeof body.style?.marble === "string" ? body.style.marble : undefined, DEFAULT_GAME_STYLE.marble),
    marbleSecondary: safeColor(typeof body.style?.marbleSecondary === "string" ? body.style.marbleSecondary : undefined, DEFAULT_GAME_STYLE.marbleSecondary),
    walls: safeColor(typeof body.style?.walls === "string" ? body.style.walls : undefined, DEFAULT_GAME_STYLE.walls),
    floor: safeColor(typeof body.style?.floor === "string" ? body.style.floor : undefined, DEFAULT_GAME_STYLE.floor),
    accent: safeColor(typeof body.style?.accent === "string" ? body.style.accent : undefined, DEFAULT_GAME_STYLE.accent),
  };
  try {
    const walletTokens = await getWalletSplTokens(hostWallet);
    const token = walletTokens.find((candidate) => candidate.mint === mint);
    if (!token) return NextResponse.json({ ok: false, error: "Selected SPL token is not currently in this wallet" }, { status: 400 });
    const orb = await createTestOrb({ hostWallet, hostX: x.user, difficulty: normalizeDifficulty(typeof body.difficulty === "string" ? body.difficulty : undefined), style, token, prizeTokenAmount, startsAt });
    return NextResponse.json({ ok: true, orb, shareUrl: `/orb/${orb.slug}` });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Could not create Orb" }, { status: 400 });
  }
}
