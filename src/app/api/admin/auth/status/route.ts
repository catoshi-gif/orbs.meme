import { NextResponse } from "next/server";
import { getAdminSession, configuredAdminWallet } from "@/lib/adminAuth";
export const runtime = "nodejs"; export const dynamic = "force-dynamic";
export async function GET() {
  const configured = configuredAdminWallet();
  const session = await getAdminSession();
  return NextResponse.json({ ok:true, configured:Boolean(configured), authenticated:Boolean(session), wallet:session?.wallet || null }, { headers:{"Cache-Control":"private, no-store"} });
}
