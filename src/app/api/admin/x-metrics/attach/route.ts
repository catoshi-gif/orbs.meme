import { NextResponse } from "next/server";
import { getAdminSession } from "@/lib/adminAuth";
import { attachHostPostForAdmin, parseXPostId } from "@/lib/xPostMetrics";
export const runtime="nodejs"; export const dynamic="force-dynamic";
export async function POST(request:Request){
  if(!await getAdminSession()) return NextResponse.json({ok:false,error:"Admin wallet authentication required"},{status:401});
  try{
    const body=await request.json() as {slug?:string;postUrl?:string};
    const slug=String(body.slug||"").trim();
    const postId=parseXPostId(String(body.postUrl||""));
    if(!slug||!postId) return NextResponse.json({ok:false,error:"Enter a valid Orb slug and X post URL"},{status:400});
    return NextResponse.json({ok:true,metrics:await attachHostPostForAdmin(slug,postId)});
  }catch(error){return NextResponse.json({ok:false,error:error instanceof Error?error.message:"Could not attach X post"},{status:422})}
}
