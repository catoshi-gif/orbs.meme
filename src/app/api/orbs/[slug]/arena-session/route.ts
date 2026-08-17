import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { getPublicOrb, orbGameType } from "@/lib/orbStore";
import { hasEligibilityReceipt } from "@/lib/eligibility";
import { hasFollowProof, hasShareProof, hasWalletProof } from "@/lib/qualification";
import { hasHumanProof } from "@/lib/turnstile";
import { getCurrentXSession } from "@/lib/xAuth";
import { getWinner } from "@/lib/upstashWinner";
import { orbEndsAt } from "@/lib/orbLifecycle";
import { assignArenaEntrantProfile, getArenaEntrantProfile } from "@/lib/arenaEntrants";
import { arenaRealtimeUrl, arenaRuntimeConfigured, arenaRuntimeHealthy, issueArenaJoinToken } from "@/lib/arenaRuntime";
import { ARENA_GAME_VERSION } from "@/game/arena";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;

function walletOf(value: unknown) {
  if (typeof value !== "string") return null;
  try { return new PublicKey(value).toBase58(); } catch { return null; }
}

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [orb, x] = await Promise.all([getPublicOrb(slug), getCurrentXSession()]);
  if (!orb || orbGameType(orb) !== "arena") return NextResponse.json({ ok:false,error:"Arena not found" }, { status:404 });
  if (!x) return NextResponse.json({ ok:false,error:"Connect X first" }, { status:401 });
  if (orb.generatorVersion !== ARENA_GAME_VERSION) return NextResponse.json({ ok:false,error:"This Arena was funded under an older gameplay version and cannot be silently upgraded. Use its existing/refund path rather than changing paid rules after creation." }, { status:409 });
  if (!arenaRuntimeConfigured()) return NextResponse.json({ ok:false,error:"Arena realtime service is not configured" }, { status:503 });
  if (!await arenaRuntimeHealthy()) return NextResponse.json({ ok:false,error:"Arena realtime service is not healthy or is running a mismatched game version" }, { status:503 });
  if (Date.now() < orb.startsAt - 60_000) return NextResponse.json({ ok:false,error:"ARENA_NOT_OPEN",startsAt:orb.startsAt }, { status:403 });
  const endsAt = orbEndsAt(orb);
  if (Date.now() >= endsAt || await getWinner(orb.id)) return NextResponse.json({ ok:false,error:"ORB_CLOSED",endsAt }, { status:409 });
  const body = await request.json().catch(() => ({})) as { wallet?: unknown };
  const wallet = walletOf(body.wallet);
  if (!wallet) return NextResponse.json({ ok:false,error:"Invalid wallet" }, { status:400 });
  if (!await hasEligibilityReceipt(wallet)) return NextResponse.json({ ok:false,error:"Confirm 18+ eligibility for this wallet before entering an Orb" }, { status:403 });
  const [followed,walletVerified,humanVerified,shared] = await Promise.all([
    hasFollowProof(x.user.id,orb.hostX.id), hasWalletProof(slug,x.user.id,wallet), hasHumanProof(slug,x.user.id,wallet), hasShareProof(slug,x.user.id,wallet),
  ]);
  if (!followed || !walletVerified || !humanVerified || !shared) return NextResponse.json({ ok:false,error:"Arena registration is not complete" }, { status:403 });
  let profile = await getArenaEntrantProfile(slug,wallet);
  if (!profile || profile.xUserId !== x.user.id) profile = await assignArenaEntrantProfile(slug,wallet,x.user);
  const issued = issueArenaJoinToken({ orbId:orb.id,slug,profile,startsAt:orb.startsAt,endsAt,commitment:orb.commitment,style:orb.style });
  return NextResponse.json({ ok:true,realtimeUrl:arenaRealtimeUrl(),token:issued.token,profile,startsAt:orb.startsAt,endsAt }, { headers:{"Cache-Control":"private, no-store"} });
}
