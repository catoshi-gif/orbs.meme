import { NextResponse } from "next/server";
import { getAdminSession } from "@/lib/adminAuth";
import { getAdminMetrics } from "@/lib/adminMetrics";
export const runtime = "nodejs"; export const dynamic = "force-dynamic"; export const maxDuration = 30;
export async function GET() {
  if (!await getAdminSession()) return NextResponse.json({ok:false,error:"Admin wallet authentication required"},{status:401});
  try { return NextResponse.json({ok:true, metrics:await getAdminMetrics()},{headers:{"Cache-Control":"private, no-store"}}); }
  catch (error) { return NextResponse.json({ok:false,error:error instanceof Error?error.message:"Could not load admin metrics"},{status:503}); }
}
