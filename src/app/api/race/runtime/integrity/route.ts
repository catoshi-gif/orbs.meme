import {NextResponse} from "next/server";
import {verifyRaceRuntimeRequest} from "@/lib/raceRuntime";
import {storeArenaIntegrityTelemetry,type ArenaIntegrityTelemetry} from "@/lib/gameIntegrity";
import {RACE_GAME_VERSION} from "@/game/race";
export const runtime="nodejs";export const dynamic="force-dynamic";export const maxDuration=20;
type Payload={schemaVersion:1;version:string;rows:ArenaIntegrityTelemetry[]};
export async function POST(request:Request){const raw=await request.text();if(!verifyRaceRuntimeRequest(raw,request.headers.get("x-race-timestamp"),request.headers.get("x-race-signature")))return NextResponse.json({ok:false,error:"Invalid Race authority signature"},{status:401});let body:Payload;try{body=JSON.parse(raw) as Payload}catch{return NextResponse.json({ok:false,error:"Invalid JSON"},{status:400})}if(body.schemaVersion!==1||body.version!==RACE_GAME_VERSION||!Array.isArray(body.rows))return NextResponse.json({ok:false,error:"Invalid integrity payload"},{status:400});try{const rows=body.rows.map(row=>({...row,game:"race" as const,version:RACE_GAME_VERSION}));return NextResponse.json({ok:true,stored:await storeArenaIntegrityTelemetry(rows)})}catch(error){return NextResponse.json({ok:false,error:error instanceof Error?error.message:"Could not store Race integrity telemetry"},{status:503})}}
