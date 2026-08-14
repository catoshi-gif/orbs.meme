import { NextResponse } from "next/server";
import { createAdminChallenge } from "@/lib/adminAuth";
export const runtime = "nodejs"; export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as { wallet?: unknown };
  if (typeof body.wallet !== "string") return NextResponse.json({ ok:false,error:"Invalid wallet"},{status:400});
  try { return NextResponse.json({ ok:true, ...(await createAdminChallenge(body.wallet)) }); }
  catch (error) { return NextResponse.json({ok:false,error:error instanceof Error?error.message:"Admin login unavailable"},{status:403}); }
}
