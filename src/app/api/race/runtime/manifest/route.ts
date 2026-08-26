import { NextResponse } from "next/server";
import { getRaceSecretSeed } from "@/lib/orbStore";
import { verifyRaceRuntimeRequest } from "@/lib/raceRuntime";
import { RACE_GAME_VERSION } from "@/game/race";
export const runtime="nodejs";export const dynamic="force-dynamic";export const maxDuration=20;
type RequestBody={schemaVersion:1;version:string;orbId:string;slug:string;commitment:string};
export async function POST(request:Request){const raw=await request.text();if(!verifyRaceRuntimeRequest(raw,request.headers.get("x-race-timestamp"),request.headers.get("x-race-signature")))return NextResponse.json({ok:false,error:"Invalid Race authority signature"},{status:401});let body:RequestBody;try{body=JSON.parse(raw)as RequestBody}catch{return NextResponse.json({ok:false,error:"Invalid JSON"},{status:400})}if(body.schemaVersion!==1||body.version!==RACE_GAME_VERSION)return NextResponse.json({ok:false,error:"Race gameplay version mismatch"},{status:409});const revealed=await getRaceSecretSeed(body.slug);if(!revealed||revealed.orb.id!==body.orbId||revealed.orb.commitment!==body.commitment||revealed.orb.generatorVersion!==RACE_GAME_VERSION)return NextResponse.json({ok:false,error:"Race manifest is not available"},{status:404});return NextResponse.json({ok:true,seed:revealed.secretSeed,style:revealed.orb.style},{headers:{"Cache-Control":"private, no-store"}})}
