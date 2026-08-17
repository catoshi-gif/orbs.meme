import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { ARENA_GAME_VERSION } from "@/game/arena";
import { getArenaEntrantProfile } from "@/lib/arenaEntrants";
import { verifyArenaRuntimeRequest } from "@/lib/arenaRuntime";
import { getOrbRecord, orbGameType } from "@/lib/orbStore";
import { orbEndsAt } from "@/lib/orbLifecycle";
import { tryAcquireWinner } from "@/lib/upstashWinner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;

type Result = {
  schemaVersion:1;
  version:string;
  matchId:string;
  orbId:string;
  slug:string;
  startedAt:number;
  completedAt:number;
  participantCount:number;
  commitment:string;
  winnerWallet:string;
  winnerXUserId:string;
  winnerUsername:string;
};

export async function POST(request: Request) {
  const raw = await request.text();
  if (!verifyArenaRuntimeRequest(raw,request.headers.get("x-arena-timestamp"),request.headers.get("x-arena-signature"))) {
    return NextResponse.json({ok:false,error:"Invalid Arena authority signature"},{status:401});
  }
  let body:Result;
  try { body=JSON.parse(raw) as Result; } catch { return NextResponse.json({ok:false,error:"Invalid JSON"},{status:400}); }
  if (body.schemaVersion!==1 || body.version!==ARENA_GAME_VERSION || !body.matchId || !body.orbId || !body.slug || !body.commitment) return NextResponse.json({ok:false,error:"Invalid Arena result"},{status:400});
  const orb=await getOrbRecord(body.slug);
  if (!orb || orb.id!==body.orbId || orbGameType(orb)!=="arena" || orb.commitment!==body.commitment) return NextResponse.json({ok:false,error:"Arena Orb mismatch"},{status:404});
  if (orb.generatorVersion!==ARENA_GAME_VERSION) return NextResponse.json({ok:false,error:"Arena gameplay version does not match funded record"},{status:409});
  const endsAt=orbEndsAt(orb), now=Date.now();
  if (body.startedAt<orb.startsAt-2_000 || body.completedAt<body.startedAt || body.completedAt>endsAt+5_000 || now<orb.startsAt) return NextResponse.json({ok:false,error:"Arena result timing is invalid"},{status:409});
  if (body.participantCount<2 || body.participantCount>200) return NextResponse.json({ok:false,error:"Arena result bounds are invalid"},{status:409});
  const profile=await getArenaEntrantProfile(body.slug,body.winnerWallet);
  if (!profile || profile.xUserId!==body.winnerXUserId || profile.username!==body.winnerUsername) return NextResponse.json({ok:false,error:"Arena winner identity is not a registered entrant"},{status:403});
  const canonical=JSON.stringify({schemaVersion:body.schemaVersion,version:body.version,matchId:body.matchId,orbId:body.orbId,slug:body.slug,startedAt:body.startedAt,completedAt:body.completedAt,participantCount:body.participantCount,commitment:body.commitment,winnerWallet:body.winnerWallet,winnerXUserId:body.winnerXUserId,winnerUsername:body.winnerUsername});
  const resultHash=createHash("sha256").update(canonical,"utf8").digest("hex");
  const lock=await tryAcquireWinner(orb.id,{
    slug:orb.slug,orbId:orb.id,replayId:`arena:${body.matchId}`,manifestHash:orb.commitment,replayHash:resultHash,
    verifiedElapsedMs:Math.max(0,Math.trunc(body.completedAt-body.startedAt)),verifiedAt:new Date(body.completedAt).toISOString(),
    wallet:body.winnerWallet,xUserId:body.winnerXUserId,xUsername:body.winnerUsername,
  });
  return NextResponse.json({ok:true,acquired:lock.acquired,winner:lock.record});
}
