import { NextResponse } from "next/server";
import { verifyArenaRuntimeRequest } from "@/lib/arenaRuntime";
import { storeArenaIntegrityTelemetry, type ArenaIntegrityTelemetry } from "@/lib/gameIntegrity";
import { ARENA_GAME_VERSION } from "@/game/arena";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;

type Payload = { schemaVersion: 1; version: string; rows: ArenaIntegrityTelemetry[] };

export async function POST(request: Request) {
  const raw = await request.text();
  if (!verifyArenaRuntimeRequest(raw, request.headers.get("x-arena-timestamp"), request.headers.get("x-arena-signature"))) {
    return NextResponse.json({ ok:false,error:"Invalid Arena authority signature" }, { status:401 });
  }
  let body: Payload;
  try { body = JSON.parse(raw) as Payload; } catch { return NextResponse.json({ ok:false,error:"Invalid JSON" }, { status:400 }); }
  if (body.schemaVersion !== 1 || body.version !== ARENA_GAME_VERSION || !Array.isArray(body.rows)) {
    return NextResponse.json({ ok:false,error:"Invalid integrity payload" }, { status:400 });
  }
  try {
    const stored = await storeArenaIntegrityTelemetry(body.rows);
    return NextResponse.json({ ok:true,stored });
  } catch (error) {
    return NextResponse.json({ ok:false,error:error instanceof Error ? error.message : "Could not store Arena integrity telemetry" }, { status:503 });
  }
}
