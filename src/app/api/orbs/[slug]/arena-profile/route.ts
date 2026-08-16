import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { getPublicOrb, orbGameType } from "@/lib/orbStore";
import { assignArenaEntrantProfile, getArenaEntrantProfile } from "@/lib/arenaEntrants";
import { hasShareProof, hasWalletProof } from "@/lib/qualification";
import { getCurrentXSession } from "@/lib/xAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function walletOf(value: unknown) { if (typeof value !== "string") return null; try { return new PublicKey(value).toBase58(); } catch { return null; } }
async function authorize(slug: string, wallet: string) {
  const [orb, x] = await Promise.all([getPublicOrb(slug), getCurrentXSession()]);
  if (!orb || orbGameType(orb) !== "arena") return { error: NextResponse.json({ ok:false,error:"Arena not found" },{status:404}) };
  if (!x) return { error: NextResponse.json({ ok:false,error:"Connect X first" },{status:401}) };
  const [walletVerified, shared] = await Promise.all([hasWalletProof(slug,x.user.id,wallet),hasShareProof(slug,x.user.id,wallet)]);
  if (!walletVerified || !shared) return { error: NextResponse.json({ ok:false,error:"Finish Arena registration before choosing your Orb color" },{status:403}) };
  return { orb, x };
}

export async function GET(request: Request,{params}:{params:Promise<{slug:string}>}) {
  const {slug}=await params, wallet=walletOf(new URL(request.url).searchParams.get("wallet"));
  if(!wallet)return NextResponse.json({ok:false,error:"Invalid wallet"},{status:400});
  const auth=await authorize(slug,wallet); if("error" in auth)return auth.error;
  const profile=await getArenaEntrantProfile(slug,wallet) || await assignArenaEntrantProfile(slug,wallet,auth.x.user);
  return NextResponse.json({ok:true,profile},{headers:{"Cache-Control":"private, no-store"}});
}
export async function POST(request: Request,{params}:{params:Promise<{slug:string}>}) {
  const {slug}=await params, body=await request.json().catch(()=>({})) as {wallet?:unknown;color?:unknown;glow?:unknown};
  const wallet=walletOf(body.wallet); if(!wallet)return NextResponse.json({ok:false,error:"Invalid wallet"},{status:400});
  const auth=await authorize(slug,wallet); if("error" in auth)return auth.error;
  const color=typeof body.color==="string"?body.color:null;
  const glow=typeof body.glow==="string"?body.glow:null;
  const profile=await assignArenaEntrantProfile(slug,wallet,auth.x.user,color,glow);
  return NextResponse.json({ok:true,profile},{headers:{"Cache-Control":"private, no-store"}});
}
