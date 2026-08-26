import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { getAdminSession } from "@/lib/adminAuth";
import { sendArenaIntegrityControl } from "@/lib/arenaRuntime";
import { sendRaceIntegrityControl } from "@/lib/raceRuntime";
import {
  banCompetitionIdentity,
  listArenaIntegrityTelemetry,
  listCompetitionRestrictions,
  unbanCompetitionIdentity,
  type CompetitionRestriction,
} from "@/lib/gameIntegrity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;

function walletOf(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  try { return new PublicKey(value).toBase58(); } catch { return null; }
}

export async function GET() {
  if (!await getAdminSession()) return NextResponse.json({ok:false,error:"Admin wallet authentication required"},{status:401});
  try {
    const [telemetry,bans] = await Promise.all([listArenaIntegrityTelemetry(160), listCompetitionRestrictions(120)]);
    return NextResponse.json({ok:true,telemetry,bans},{headers:{"Cache-Control":"private, no-store"}});
  } catch (error) {
    return NextResponse.json({ok:false,error:error instanceof Error?error.message:"Could not load integrity data"},{status:503});
  }
}

export async function POST(request: Request) {
  const admin = await getAdminSession();
  if (!admin) return NextResponse.json({ok:false,error:"Admin wallet authentication required"},{status:401});
  const body = await request.json().catch(() => ({})) as {
    action?: unknown;
    wallet?: unknown;
    xUserId?: unknown;
    username?: unknown;
    reason?: unknown;
    record?: CompetitionRestriction;
  };
  const action = body.action === "ban" || body.action === "unban" ? body.action : null;
  if (!action) return NextResponse.json({ok:false,error:"Invalid integrity action"},{status:400});

  if (action === "ban") {
    const rawWallet = typeof body.wallet === "string" ? body.wallet.trim() : "";
    const wallet = rawWallet ? walletOf(rawWallet) : null;
    if (rawWallet && !wallet) return NextResponse.json({ok:false,error:"Invalid wallet"},{status:400});
    const xUserId = typeof body.xUserId === "string" ? body.xUserId.trim().slice(0,80) : "";
    if (!wallet && !xUserId) return NextResponse.json({ok:false,error:"Wallet or X user ID required"},{status:400});
    try {
      const record = await banCompetitionIdentity({
        wallet,
        xUserId: xUserId || null,
        username: typeof body.username === "string" ? body.username : null,
        reason: typeof body.reason === "string" ? body.reason : null,
        createdBy: admin.wallet,
      });
      const [arenaControl,raceControl]=await Promise.all([sendArenaIntegrityControl({action:"ban",wallet:record.wallet,xUserId:record.xUserId}),sendRaceIntegrityControl({action:"ban",wallet:record.wallet,xUserId:record.xUserId})]);
      return NextResponse.json({ok:true,record,kicked:arenaControl.kicked+raceControl.kicked,runtimeReached:arenaControl.ok||raceControl.ok});
    } catch (error) {
      return NextResponse.json({ok:false,error:error instanceof Error?error.message:"Could not restrict player"},{status:503});
    }
  }

  const record = body.record;
  if (!record?.id) return NextResponse.json({ok:false,error:"Restriction record required"},{status:400});
  try {
    await unbanCompetitionIdentity(record);
    const [arenaControl,raceControl]=await Promise.all([sendArenaIntegrityControl({action:"unban",wallet:record.wallet,xUserId:record.xUserId}),sendRaceIntegrityControl({action:"unban",wallet:record.wallet,xUserId:record.xUserId})]);
    return NextResponse.json({ok:true,runtimeReached:arenaControl.ok||raceControl.ok});
  } catch (error) {
    return NextResponse.json({ok:false,error:error instanceof Error?error.message:"Could not remove restriction"},{status:503});
  }
}
