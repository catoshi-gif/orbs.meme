"use client";
import { useCallback, useEffect, useState } from "react";

type Profile={orbColor:string;username:string;profileImageUrl?:string|null};
const randomHex=()=>`#${Array.from(crypto.getRandomValues(new Uint8Array(3)),v=>v.toString(16).padStart(2,"0")).join("").toUpperCase()}`;
export default function ArenaOrbIdentity({slug,wallet}:{slug:string;wallet:string}){
  const [profile,setProfile]=useState<Profile|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null);
  const load=useCallback(async()=>{if(!wallet)return;try{const r=await fetch(`/api/orbs/${encodeURIComponent(slug)}/arena-profile?wallet=${encodeURIComponent(wallet)}`,{cache:"no-store"});const p=await r.json();if(!r.ok||!p.profile)throw new Error(p.error||"Could not prepare your Arena Orb");setProfile(p.profile)}catch(e){setError(e instanceof Error?e.message:"Could not prepare your Arena Orb")}},[slug,wallet]);
  useEffect(()=>{void load()},[load]);
  const save=async(color:string)=>{setBusy(true);setError(null);try{const r=await fetch(`/api/orbs/${encodeURIComponent(slug)}/arena-profile`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({wallet,color})});const p=await r.json();if(!r.ok||!p.profile)throw new Error(p.error||"Could not save Orb color");setProfile(p.profile)}catch(e){setError(e instanceof Error?e.message:"Could not save Orb color")}finally{setBusy(false)}};
  if(!profile&&!error)return <div className="arena-identity-card"><strong>Preparing your Arena Orb…</strong></div>;
  return <div className="arena-identity-card"><div className="arena-identity-copy"><span>YOUR ARENA ORB</span><strong>Choose your color.</strong><small>Every entrant is assigned a distinct color automatically. Change yours if you want; your X profile picture will ride beneath your Orb in the live Arena.</small></div>{profile?<div className="arena-identity-control"><div className="arena-orb-preview" style={{background:`radial-gradient(circle at 35% 25%,#fff,${profile.orbColor} 34%,#050817 100%)`,boxShadow:`0 0 34px ${profile.orbColor}88`}}>{profile.profileImageUrl?<img src={profile.profileImageUrl} alt="" referrerPolicy="no-referrer"/>:null}</div><label><span>Orb color</span><input type="color" value={profile.orbColor} disabled={busy} onChange={(e)=>void save(e.target.value.toUpperCase())}/></label><button type="button" className="mini-action" disabled={busy} onClick={()=>void save(randomHex())}>{busy?"Saving…":"Randomize"}</button></div>:null}{error?<small className="q-error">{error}</small>:null}</div>;
}
