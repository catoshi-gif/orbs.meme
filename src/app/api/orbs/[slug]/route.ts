import { NextResponse } from "next/server";
import { getPublicOrb } from "@/lib/orbStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const orb = await getPublicOrb(slug);
  if (!orb) return NextResponse.json({ ok: false, error: "Orb not found" }, { status: 404 });
  return NextResponse.json({ ok: true, orb }, { headers: { "Cache-Control": "public, max-age=2, s-maxage=2" } });
}
