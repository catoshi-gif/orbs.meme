"use client";

import { useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import ConnectWallet from "@/components/ConnectWallet";

function b64(bytes: Uint8Array) { let s=""; for (const b of bytes) s+=String.fromCharCode(b); return btoa(s); }
function money(v:number){return new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumFractionDigits:2}).format(v||0)}
function duration(ms:number|null){if(!ms)return "—"; const s=ms/1000; return s<60?`${s.toFixed(2)}s`:`${Math.floor(s/60)}m ${(s%60).toFixed(1)}s`}
function short(w:string|null){return w?`${w.slice(0,6)}…${w.slice(-4)}`:"—"}
function pct(v:number|null|undefined){return typeof v==="number"&&Number.isFinite(v)?`${(v*100).toFixed(1)}%`:"—"}

type Metrics = {
  generatedAt:string;
  totals: Record<string, number|null>;
  xMetrics:{enabled:boolean;trackedPosts:number;estimatedRefreshUsd:number;totalImpressions:number;reason:string};
  games:Array<{
    slug:string;id:string;createdAt:number;startsAt:number;endsAt:number;phase:string;hostWallet:string;hostXUsername:string;hostSharePostId:string|null;
    xImpressions:number|null;xLikes:number|null;xReposts:number|null;xReplies:number|null;xQuotes:number|null;xMetricsRefreshedAt:number|null;
    waitingRoomVisitors:number;participants:number;verifiedEntryPosts:number;liveRacers:number;registrationRate:number|null;showRate:number|null;
    prizeUsd:number;prizeTokenAmount:number;tokenSymbol:string;feeUsd:number;
    winnerXUsername:string|null;winnerWallet:string|null;verifiedElapsedMs:number|null;claimed:boolean;fundingTxSignature:string|null;claimTxSignature:string|null;
  }>;
};

export default function AdminDashboard(){
  const {publicKey,signMessage}=useWallet();
  const wallet=publicKey?.toBase58()||"";
  const [authenticated,setAuthenticated]=useState(false);
  const [sessionWallet,setSessionWallet]=useState<string|null>(null);
  const [configured,setConfigured]=useState(true);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState<string|null>(null);
  const [metrics,setMetrics]=useState<Metrics|null>(null);
  const [xBusy,setXBusy]=useState(false);
  const [attachValues,setAttachValues]=useState<Record<string,string>>({});

  const loadStatus=async()=>{
    const r=await fetch("/api/admin/auth/status",{cache:"no-store"});
    const p=await r.json() as {configured?:boolean;authenticated?:boolean;wallet?:string|null};
    setConfigured(Boolean(p.configured)); setAuthenticated(Boolean(p.authenticated)); setSessionWallet(p.wallet||null);
  };
  const loadMetrics=async()=>{
    setError(null);
    const r=await fetch("/api/admin/metrics",{cache:"no-store"});
    const p=await r.json() as {ok?:boolean;metrics?:Metrics;error?:string};
    if(!r.ok||!p.ok||!p.metrics) throw new Error(p.error||"Could not load admin metrics");
    setMetrics(p.metrics);
  };
  const refreshX=async()=>{
    setXBusy(true);setError(null);
    try{
      const r=await fetch("/api/admin/x-metrics/refresh",{method:"POST",headers:{Accept:"application/json"}});
      const p=await r.json() as {ok?:boolean;result?:{postsRead:number;estimatedCostUsd:number;totalImpressions:number};error?:string};
      if(!r.ok||!p.ok) throw new Error(p.error||"Could not refresh X reach");
      await loadMetrics();
    }catch(e){setError(e instanceof Error?e.message:"Could not refresh X reach")}finally{setXBusy(false)}
  };
  const attachPost=async(slug:string)=>{
    const postUrl=(attachValues[slug]||"").trim();
    if(!postUrl){setError("Paste the host X post URL first.");return}
    setXBusy(true);setError(null);
    try{
      const r=await fetch("/api/admin/x-metrics/attach",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({slug,postUrl})});
      const p=await r.json() as {ok?:boolean;error?:string};
      if(!r.ok||!p.ok) throw new Error(p.error||"Could not attach X post");
      setAttachValues(v=>({...v,[slug]:""}));
      await loadMetrics();
    }catch(e){setError(e instanceof Error?e.message:"Could not attach X post")}finally{setXBusy(false)}
  };
  useEffect(()=>{void loadStatus()},[]);
  useEffect(()=>{if(authenticated && wallet && wallet===sessionWallet) void loadMetrics().catch(e=>setError(e instanceof Error?e.message:"Could not load metrics"))},[authenticated,wallet,sessionWallet]);

  const unlock=async()=>{
    if(!wallet||!signMessage){setError("Connect the configured admin wallet with message signing support.");return}
    setBusy(true);setError(null);
    try{
      const c=await fetch("/api/admin/auth/challenge",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({wallet})});
      const cp=await c.json() as {ok?:boolean;message?:string;error?:string};
      if(!c.ok||!cp.ok||!cp.message) throw new Error(cp.error||"Could not create admin challenge");
      const sig=await signMessage(new TextEncoder().encode(cp.message));
      const v=await fetch("/api/admin/auth/verify",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({wallet,signature:b64(sig)})});
      const vp=await v.json() as {ok?:boolean;error?:string};
      if(!v.ok||!vp.ok) throw new Error(vp.error||"Admin verification failed");
      setAuthenticated(true); setSessionWallet(wallet);
    }catch(e){setError(e instanceof Error?e.message:"Admin verification failed")}finally{setBusy(false)}
  };

  if(!configured) return <div className="card admin-lock"><h2>Admin is not configured.</h2><p>Add the server-only <code>ADMIN_WALLET</code> environment variable, then redeploy.</p></div>;
  if(authenticated && (!wallet || wallet!==sessionWallet)) return <div className="card admin-lock"><span className="eyebrow">Private operator console</span><h2>Connect the authenticated admin wallet.</h2><p>The admin session is valid, but the matching wallet must remain connected in this browser to display operator metrics.</p><ConnectWallet/></div>;
  if(!authenticated) return <div className="card admin-lock"><span className="eyebrow">Private operator console</span><h2>Wallet signature required.</h2><p>Only the wallet configured in <code>ADMIN_WALLET</code> can open this dashboard.</p>{!wallet?<ConnectWallet/>:<><code>{wallet}</code><button className="btn-primary" onClick={()=>void unlock()} disabled={busy||!signMessage}>{busy?"Verifying…":"Unlock admin →"}</button></>}{error?<div className="form-error">{error}</div>:null}</div>;
  if(!metrics) return <div className="card admin-lock"><h2>Loading operator metrics…</h2>{error?<div className="form-error">{error}</div>:null}</div>;

  const T=metrics.totals;
  const cards=[
    ["Funded Orbs",T.fundedOrbs],["Waiting-room visitors",T.waitingRoomVisitors],["Qualified entries",T.totalQualifiedEntries],
    ["Live racers",T.totalLiveRacers],["Avg racers / Orb",Number(T.averageRacersPerFundedOrb||0).toFixed(2)],["Registration rate",pct(T.waitingToRegistrationRate as number|null)],
    ["Show rate",pct(T.registrationToRaceRate as number|null)],["Verified winners",T.completedWithWinner],["Claimed prizes",T.claimedPrizes],
    ["Prize volume",money(Number(T.totalWinnerPrizeUsdAtFunding||0))],["Protocol fees",money(Number(T.totalProtocolFeesUsdAtFunding||0))],
    ["Unique host X accounts",T.uniqueHostXAccounts],["X host impressions",metrics.xMetrics.totalImpressions.toLocaleString()],["Fastest win",duration(T.fastestVerifiedWinMs as number|null)]
  ];
  return <div className="admin-dashboard">
    <div className="admin-toolbar"><div><span className="eyebrow">Private operator console</span><h1>Orbs network metrics</h1><p>Generated {new Date(metrics.generatedAt).toLocaleString()}</p></div><div className="admin-toolbar-actions"><a className="btn-secondary" href="/api/admin/metrics/export">Export lifetime CSV</a><button className="btn-secondary" onClick={()=>void loadMetrics().catch(e=>setError(e instanceof Error?e.message:"Refresh failed"))}>Refresh DB</button><button className="btn-primary" onClick={()=>void refreshX()} disabled={xBusy||!metrics.xMetrics.enabled||metrics.xMetrics.trackedPosts===0}>{xBusy?"Refreshing X…":`Refresh X reach · ~${money(metrics.xMetrics.estimatedRefreshUsd)}`}</button></div></div>
    <div className="admin-stats">{cards.map(([k,v])=><div className="card admin-stat" key={String(k)}><span>{k}</span><strong>{String(v??"—")}</strong></div>)}</div>
    <div className="card admin-x-note"><strong>Lifetime product analytics</strong><p>Funded-Orb snapshots and aggregate funnel counts have no TTL. Waiting-room and racer identity sets are used only to deduplicate active games, then expire; the lifetime counts remain. Historical waiting-room visitors and live racers begin when this analytics version is deployed because those events were not previously persisted.</p></div>
    <div className="card admin-x-note"><strong>Manual X reach analytics</strong><p>{metrics.xMetrics.reason} Tracked host posts: {metrics.xMetrics.trackedPosts}. Cached total impressions: {metrics.xMetrics.totalImpressions.toLocaleString()}. X currently charges about $0.005 per Post read, so the button estimates the cost before you refresh.</p></div>
    <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Orb</th><th>Host</th><th>Phase</th><th>Prize</th><th>Funnel</th><th>X reach</th><th>Winner</th><th>Claimed</th><th>Launch</th></tr></thead><tbody>{metrics.games.map(g=><tr key={g.id}><td><a href={`/orb/${g.slug}`}>{g.slug}</a><small>{short(g.hostWallet)}</small></td><td><a href={`https://x.com/${encodeURIComponent(g.hostXUsername)}`} target="_blank" rel="noreferrer">@{g.hostXUsername}</a>{g.hostSharePostId?<small><a href={`https://x.com/${encodeURIComponent(g.hostXUsername)}/status/${g.hostSharePostId}`} target="_blank" rel="noreferrer">host post ↗</a></small>:<div className="admin-x-attach"><input value={attachValues[g.slug]||""} onChange={e=>setAttachValues(v=>({...v,[g.slug]:e.target.value}))} placeholder="paste host post URL" /><button className="mini-action" onClick={()=>void attachPost(g.slug)} disabled={xBusy}>attach</button></div>}</td><td>{g.phase}</td><td>{g.prizeTokenAmount.toLocaleString(undefined,{maximumFractionDigits:6})} {g.tokenSymbol}<small>{money(g.prizeUsd)}</small></td><td><strong>{g.liveRacers} racers</strong><small>{g.waitingRoomVisitors} waiting · {g.participants} registered</small><small>{pct(g.registrationRate)} register · {pct(g.showRate)} show</small></td><td>{g.xImpressions===null?"—":g.xImpressions.toLocaleString()}<small>{g.xImpressions===null?g.hostSharePostId?"not refreshed yet":"attach host post first":`${g.xReposts||0} reposts · ${g.xLikes||0} likes`}</small></td><td>{g.winnerXUsername?<><a href={`https://x.com/${encodeURIComponent(g.winnerXUsername)}`} target="_blank" rel="noreferrer">@{g.winnerXUsername}</a><small>{short(g.winnerWallet)}</small></>:"—"}</td><td>{g.claimed?"yes":"no"}</td><td>{new Date(g.startsAt).toLocaleString()}</td></tr>)}</tbody></table></div>
    {error?<div className="form-error">{error}</div>:null}
  </div>
}
