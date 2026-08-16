import { ImageResponse } from "next/og";
import sharp from "sharp";
import { getPublicOrb, orbGameType } from "@/lib/orbStore";
import { getWinner } from "@/lib/upstashWinner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const width = 1200, height = 630;
function amount(value:number){return value.toLocaleString("en-US",{maximumFractionDigits:6});}
function money(value:number){return new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumFractionDigits:2}).format(value);}
function time(ms:number){const m=Math.floor(ms/60000),s=Math.floor((ms%60000)/1000),x=Math.floor(ms%1000);return `${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}.${String(x).padStart(3,"0")}`;}
function safeRemoteImage(value:string|null|undefined, kind:"token"|"avatar") { if(!value)return null; try{const url=new URL(value),host=url.hostname.toLowerCase();const allowed=kind==="token"?["static.jup.ag","jup.ag","arweave.net","ipfs.io","gateway.pinata.cloud","raw.githubusercontent.com"]:["pbs.twimg.com"];return url.protocol==="https:"&&allowed.some(d=>host===d||host.endsWith(`.${d}`))?url.toString():null;}catch{return null;} }
async function loadRemoteImage(value:string|null){if(!value)return null;try{const r=await fetch(value,{cache:"force-cache",signal:AbortSignal.timeout(5000)}),type=(r.headers.get("content-type")||"").split(";")[0].toLowerCase();if(!r.ok||!type.startsWith("image/")||type==="image/svg+xml")return null;const bytes=Buffer.from(await r.arrayBuffer());if(!bytes.length||bytes.length>2_000_000)return null;const png=await sharp(bytes,{animated:false}).resize(256,256,{fit:"contain",withoutEnlargement:true}).png().toBuffer();return `data:image/png;base64,${png.toString("base64")}`;}catch{return null;}}
function missing(){return new ImageResponse(<div style={{width:"100%",height:"100%",display:"flex",alignItems:"center",justifyContent:"center",background:"#050817",color:"white",fontSize:52,fontWeight:900}}>VERIFIED WIN NOT FOUND</div>,{width,height,status:404});}

export async function GET(request:Request,{params}:{params:Promise<{slug:string}>}){
 const {slug}=await params; const orb=await getPublicOrb(slug); if(!orb)return missing(); const winner=await getWinner(orb.id); if(!winner?.claimTxSignature||!winner.claimedAt)return missing();
 const gameType=orbGameType(orb);
 const tokenLogo=await loadRemoteImage(safeRemoteImage(orb.token.logoURI,"token"));
 const origin=new URL(request.url).origin, brandLogo=`${origin}/orbs-logo-128.png`, background=`${origin}/orbs-share-bg.jpg`;
 const tokenAmount=amount(orb.prizeTokenAmount), symbol=orb.token.symbol.slice(0,16), username=winner.xUsername?`@${winner.xUsername}`:"verified winner", finish=time(winner.verifiedElapsedMs);
 const png=new ImageResponse(<div style={{width:"100%",height:"100%",display:"flex",position:"relative",overflow:"hidden",color:"#F8FAFF",background:"#030617",fontFamily:"sans-serif"}}>
  <img src={background} alt="" width={1200} height={630} style={{position:"absolute",inset:0,width:1200,height:630,objectFit:"cover"}}/>
  <div style={{position:"absolute",inset:0,display:"flex",background:"linear-gradient(90deg,rgba(2,5,20,.94),rgba(3,7,25,.84) 48%,rgba(3,5,19,.32))"}}/>
  <div style={{position:"absolute",right:55,top:90,width:330,height:330,borderRadius:999,display:"flex",alignItems:"center",justifyContent:"center",background:`radial-gradient(circle at 35% 30%,#fff,${orb.style.marbleSecondary} 16%,${orb.style.marble} 55%,${orb.style.floor} 78%)`,border:"4px solid #FFFFFF44",boxShadow:`0 0 90px ${orb.style.marble}99`}}><div style={{display:"flex",fontSize:116}}>🏆</div></div>
  <div style={{position:"relative",width:"100%",display:"flex",flexDirection:"column",padding:"40px 55px 38px 60px"}}>
   <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}><div style={{display:"flex",alignItems:"center",gap:13}}><img src={brandLogo} alt="" width={58} height={58}/><div style={{display:"flex",fontSize:31,fontWeight:900}}>orbs<span style={{color:"#8D70FF"}}>.meme</span></div></div><div style={{display:"flex",padding:"9px 14px",border:"1px solid #76F4EA66",borderRadius:999,color:"#76F4EA",fontSize:14,fontWeight:900,letterSpacing:2}}>{gameType.toUpperCase()} · CONTEST WINNER</div></div>
   <div style={{display:"flex",flexDirection:"column",width:700,marginTop:65}}><div style={{display:"flex",color:"#76F4EA",fontSize:17,fontWeight:900,letterSpacing:2.5}}>{gameType === "arena" ? "ARENA WON · PRIZE CLAIMED ONCHAIN" : "ORB CLEARED · PRIZE CLAIMED ONCHAIN"}</div><div style={{display:"flex",fontSize:66,lineHeight:1,fontWeight:900,letterSpacing:-3,marginTop:10}}>{gameType === "arena" ? "I Won the Arena." : "I Won the Maze."}</div><div style={{display:"flex",alignItems:"center",gap:15,marginTop:24}}>{tokenLogo?<img src={tokenLogo} alt="" width={66} height={66} style={{width:66,height:66,borderRadius:999,objectFit:"cover"}}/>:null}<div style={{display:"flex",flexDirection:"column"}}><div style={{display:"flex",fontSize:40,fontWeight:900}}>{tokenAmount} {symbol}</div><div style={{display:"flex",color:"#C4CCE3",fontSize:18,fontWeight:700}}>{money(orb.prizeUsd)} Winner Prize</div></div></div></div>
   <div style={{display:"flex",alignItems:"center",gap:26,marginTop:"auto",borderTop:"1px solid #FFFFFF2B",paddingTop:20}}><div style={{display:"flex",flexDirection:"column"}}><div style={{display:"flex",color:"#AEB8D2",fontSize:12,fontWeight:800,letterSpacing:1.5}}>WINNER</div><div style={{display:"flex",fontSize:22,fontWeight:900}}>{username}</div></div><div style={{width:1,height:43,display:"flex",background:"#FFFFFF2B"}}/><div style={{display:"flex",flexDirection:"column"}}><div style={{display:"flex",color:"#AEB8D2",fontSize:12,fontWeight:800,letterSpacing:1.5}}>{gameType === "arena" ? "WINNER VERIFIED" : "VERIFIED FINISH"}</div><div style={{display:"flex",fontSize:22,fontWeight:900}}>{gameType === "arena" ? "ARENA" : finish}</div></div><div style={{marginLeft:"auto",display:"flex",flexDirection:"column",alignItems:"flex-end"}}><div style={{display:"flex",color:"#76F4EA",fontSize:16,fontWeight:900}}>SKILL COMPETITION WIN</div><div style={{display:"flex",color:"#AEB8D2",fontSize:12,fontWeight:800}}>#ContestWinner · orbs.meme</div></div></div>
  </div>
 </div>,{width,height});
 const jpeg=await sharp(Buffer.from(await png.arrayBuffer())).jpeg({quality:84,chromaSubsampling:"4:4:4",progressive:true,mozjpeg:true}).toBuffer();
 return new Response(new Uint8Array(jpeg),{headers:{"Content-Type":"image/jpeg","Content-Disposition":`inline; filename="orbs-${slug}-winner.jpg"`,"Content-Length":String(jpeg.byteLength),"Cache-Control":"public, max-age=300, s-maxage=3600, stale-while-revalidate=86400","X-Content-Type-Options":"nosniff"}});
}
