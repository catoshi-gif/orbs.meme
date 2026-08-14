import { NextResponse } from "next/server";
import { verifyAdminChallenge } from "@/lib/adminAuth";
export const runtime = "nodejs"; export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as { wallet?: unknown; signature?: unknown };
  if (typeof body.wallet !== "string" || typeof body.signature !== "string") return NextResponse.json({ok:false,error:"Invalid admin verification request"},{status:400});
  const ok = await verifyAdminChallenge(body.wallet, body.signature).catch(() => false);
  return ok ? NextResponse.json({ok:true}) : NextResponse.json({ok:false,error:"Admin wallet signature was not accepted"},{status:403});
}
