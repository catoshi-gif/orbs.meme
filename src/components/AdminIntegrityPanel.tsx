"use client";

import { useEffect, useMemo, useState } from "react";

type Telemetry = {
  matchId:string;orbId:string;slug:string;sampledAt:number;phase:string;playerId:string;wallet:string;xUserId:string;username:string;
  followersCount:number|null;ipHash:string|null;sameIpPeers:number;alive:boolean;health:number;score:number;level:"normal"|"watch"|"high";signals:string[];
  movementPatternScore:number;positionLoopScore:number;actionRegularityScore:number;recoveryZoneShare:number;recoveryPickups:number;blockedPickupAttempts:number;actions:number;inputSamples:number;positionSamples:number;
};
type Ban = {id:string;wallet:string|null;xUserId:string|null;username:string|null;reason:string;createdAt:number;createdBy:string;active:true};

function short(value:string|null){return value?`${value.slice(0,6)}…${value.slice(-4)}`:"—"}
function pct(value:number){return `${Math.round(Math.max(0,Math.min(1,value))*100)}%`}

export default function AdminIntegrityPanel(){
  const [telemetry,setTelemetry]=useState<Telemetry[]>([]);
  const [bans,setBans]=useState<Ban[]>([]);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState<string|null>(null);
  const [message,setMessage]=useState<string|null>(null);
  const [error,setError]=useState<string|null>(null);

  const load=async(silent=false)=>{
    if(!silent)setLoading(true);
    try{
      const response=await fetch("/api/admin/integrity",{cache:"no-store"});
      const payload=await response.json() as {ok?:boolean;telemetry?:Telemetry[];bans?:Ban[];error?:string};
      if(!response.ok||!payload.ok)throw new Error(payload.error||"Could not load integrity telemetry");
      setTelemetry(Array.isArray(payload.telemetry)?payload.telemetry:[]);
      setBans(Array.isArray(payload.bans)?payload.bans:[]);
      setError(null);
    }catch(e){setError(e instanceof Error?e.message:"Could not load integrity telemetry")}finally{if(!silent)setLoading(false)}
  };

  useEffect(()=>{void load();const timer=window.setInterval(()=>void load(true),15_000);return()=>window.clearInterval(timer)},[]);

  const activeBanKeys=useMemo(()=>{const set=new Set<string>();for(const ban of bans){if(ban.wallet)set.add(`w:${ban.wallet}`);if(ban.xUserId)set.add(`x:${ban.xUserId}`)}return set},[bans]);
  const rows=useMemo(()=>[...telemetry].sort((a,b)=>b.score-a.score||b.sampledAt-a.sampledAt),[telemetry]);

  const banPlayer=async(row:Telemetry)=>{
    if(!window.confirm(`Restrict @${row.username} from Orbs competitions? This blocks both the X account and wallet and will eject the player if they are currently in a live Arena.`))return;
    setBusy(row.wallet);setMessage(null);setError(null);
    try{
      const response=await fetch("/api/admin/integrity",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"ban",wallet:row.wallet,xUserId:row.xUserId,username:row.username})});
      const payload=await response.json() as {ok?:boolean;kicked?:number;runtimeReached?:boolean;error?:string};
      if(!response.ok||!payload.ok)throw new Error(payload.error||"Could not restrict player");
      setMessage(`@${row.username} restricted.${payload.kicked?` ${payload.kicked} live player${payload.kicked===1?"":"s"} ejected.`:""}${payload.runtimeReached===false?" The persistent ban is active; the Arena runtime could not be reached for a live kick.":""}`);
      await load(true);
    }catch(e){setError(e instanceof Error?e.message:"Could not restrict player")}finally{setBusy(null)}
  };

  const unban=async(record:Ban)=>{
    if(!window.confirm(`Remove the competition restriction for ${record.username?`@${record.username}`:"this identity"}?`))return;
    setBusy(record.id);setMessage(null);setError(null);
    try{
      const response=await fetch("/api/admin/integrity",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"unban",record})});
      const payload=await response.json() as {ok?:boolean;error?:string};
      if(!response.ok||!payload.ok)throw new Error(payload.error||"Could not remove restriction");
      setMessage("Competition restriction removed.");
      await load(true);
    }catch(e){setError(e instanceof Error?e.message:"Could not remove restriction")}finally{setBusy(null)}
  };

  return <section className="admin-integrity">
    <div className="admin-sandbox-heading">
      <div><span className="eyebrow">Fair-play integrity</span><h2>Bot telemetry · shadow mode</h2><p>Authoritative Arena movement is scored for repetitive input cycles, repeating paths, machine-like action cadence, pickup camping, shared IP fingerprints, and X follower count. Scores never auto-ban or auto-eject; enforcement is manual from this panel.</p></div>
      <button className="btn-secondary" onClick={()=>void load()} disabled={loading}>{loading?"Loading…":"Refresh telemetry"}</button>
    </div>
    {message?<div className="admin-integrity-message">{message}</div>:null}
    {error?<div className="form-error">{error}</div>:null}
    <div className="admin-table-wrap"><table className="admin-table admin-integrity-table"><thead><tr><th>Risk</th><th>Player</th><th>X followers</th><th>Signals</th><th>Behavior</th><th>Network</th><th>Game</th><th>Action</th></tr></thead><tbody>
      {rows.length?rows.map(row=>{const banned=activeBanKeys.has(`w:${row.wallet}`)||activeBanKeys.has(`x:${row.xUserId}`);return <tr key={`${row.matchId}:${row.wallet}`}>
        <td><strong className={`integrity-score ${row.level}`}>{row.score}</strong><small>{row.level.toUpperCase()}</small></td>
        <td><a href={`https://x.com/${encodeURIComponent(row.username)}`} target="_blank" rel="noreferrer">@{row.username}</a><small>{short(row.wallet)}</small><small>X ID {short(row.xUserId)}</small></td>
        <td><strong>{row.followersCount===null?"—":row.followersCount.toLocaleString()}</strong>{row.followersCount===0?<small className="integrity-warning">zero followers</small>:null}</td>
        <td>{row.signals.length?row.signals.slice(0,4).map(signal=><small key={signal}>{signal}</small>):<small>no strong signals</small>}</td>
        <td><small>input loop {pct(row.movementPatternScore)}</small><small>path loop {pct(row.positionLoopScore)}</small><small>action cadence {pct(row.actionRegularityScore)}</small><small>health zone {pct(row.recoveryZoneShare)} · pickups {row.recoveryPickups}</small></td>
        <td><code>{row.ipHash||"—"}</code><small>{row.sameIpPeers?`${row.sameIpPeers+1} entrants share fingerprint`:"unique in this Arena"}</small></td>
        <td><a href={`/orb/${encodeURIComponent(row.slug)}`}>{row.slug}</a><small>{row.phase} · {row.alive?`${row.health} HP`:`eliminated`}</small><small>{new Date(row.sampledAt).toLocaleTimeString()}</small></td>
        <td>{banned?<span className="integrity-banned">BLOCKED</span>:<button className="mini-action integrity-ban" onClick={()=>void banPlayer(row)} disabled={busy===row.wallet}>{busy===row.wallet?"Blocking…":"Ban X + wallet"}</button>}</td>
      </tr>}) : <tr><td colSpan={8}><small>{loading?"Loading Arena telemetry…":"No Arena integrity telemetry has been reported yet."}</small></td></tr>}
    </tbody></table></div>
    <div className="card admin-x-note"><strong>Active competition restrictions</strong><p>Restrictions are enforced before both ARENA and MAZE competitive sessions are issued. X user ID and wallet are stored together so changing an X username does not bypass the block. IP fingerprints are evidence only and never automatically ban everyone on the same connection.</p>
      {bans.length?<div className="admin-integrity-bans">{bans.map(ban=><div className="admin-integrity-ban-row" key={ban.id}><span>{ban.username?`@${ban.username}`:"X account"}</span><code>{short(ban.wallet)}</code><small>{new Date(ban.createdAt).toLocaleString()}</small><button className="mini-action" onClick={()=>void unban(ban)} disabled={busy===ban.id}>{busy===ban.id?"Removing…":"Unban"}</button></div>)}</div>:<p>No active restrictions.</p>}
    </div>
  </section>
}
