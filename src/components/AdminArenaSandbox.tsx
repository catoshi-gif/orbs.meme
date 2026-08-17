"use client";

import { useMemo, useRef, useState } from "react";
import ArenaSandbox from "@/components/game/ArenaSandbox";
import { GAME_STYLE_PRESETS } from "@/game/constants";
import { arenaRadiusForPlayers, type ArenaPace } from "@/game/arena";
import type { GameStyle } from "@/game/types";

type CaptureFormat = "landscape" | "square" | "portrait";

type Draft = GameStyle & {
  seed: string;
  playerCount: number;
  pace: ArenaPace;
};

type ActiveDemo = Draft & { generation: number };

const HEX = /^#[0-9a-fA-F]{6}$/;
const EMPTY: Draft = {
  seed: "",
  playerCount: 12,
  pace: "demo",
  marble: "#5B5CF6",
  marbleSecondary: "#20E3D2",
  walls: "#20E3D2",
  floor: "#071126",
  accent: "#9A5CFF",
};

function randomSeed() {
  const bytes = new Uint8Array(8); crypto.getRandomValues(bytes);
  return Array.from(bytes, value => value.toString(16).padStart(2,"0")).join("");
}

function randomArenaStyle(): GameStyle {
  const hue = Math.floor(Math.random()*360);
  const h=(n:number)=>`hsl(${(hue+n)%360} 88% 60%)`;
  const asHex=(css:string)=>{ const c=document.createElement("canvas").getContext("2d")!; c.fillStyle=css; return c.fillStyle.toUpperCase(); };
  return { marble:asHex(h(0)), marbleSecondary:asHex(h(55)), walls:asHex(h(115)), floor:"#050817", accent:asHex(h(205)) };
}

export default function AdminArenaSandbox(){
  const [draft,setDraft]=useState<Draft>(EMPTY);
  const [active,setActive]=useState<ActiveDemo|null>(null);
  const [format,setFormat]=useState<CaptureFormat>("landscape");
  const captureRef=useRef<HTMLDivElement>(null);
  const ready=[draft.marble,draft.marbleSecondary,draft.walls,draft.floor,draft.accent].every(v=>HEX.test(v))&&draft.seed.trim().length>=2;
  const radius=useMemo(()=>arenaRadiusForPlayers(draft.playerCount),[draft.playerCount]);
  const update=<K extends keyof Draft>(key:K,value:Draft[K])=>setDraft(current=>({...current,[key]:value}));
  const loadStyle=(style:GameStyle)=>setDraft(current=>({...current,...style}));
  const randomize=()=>setDraft(current=>({...current,...randomArenaStyle(),seed:randomSeed()}));
  const generate=()=>{if(!ready)return;setActive({...draft,seed:draft.seed.trim(),generation:Date.now()})};
  const fullscreen=async()=>{try{await captureRef.current?.requestFullscreen?.({navigationUI:"hide"})}catch{}};

  return <section className="admin-game-sandbox admin-arena-sandbox">
    <div className="admin-sandbox-heading">
      <div><span className="eyebrow">Multiplayer laboratory</span><h2>Arena game generator</h2><p>Local-only mirror of the live Arena rules with computer opponents. Tune population, palette and capture format here without touching prize state; ring-outs, column zaps, ramp spikes, crescent Blaster pulses, powers and recovery match the production game.</p></div>
      <span className="admin-sandbox-local">ADMIN ONLY · NO PRIZE STATE</span>
    </div>
    <div className="admin-sandbox-builder card">
      <div className="admin-sandbox-section">
        <span className="admin-sandbox-label">01 · Match population</span>
        <div className="arena-builder-population">
          <label><span>Players / Orbs</span><input type="range" min="2" max="200" step="1" value={draft.playerCount} onChange={e=>update("playerCount",Number(e.target.value))}/><strong>{draft.playerCount}</strong></label>
          <div className="arena-scale-readout"><span>Course footprint</span><strong>{radius.toFixed(1)}m</strong><small>Authored terrain scales with population; movement physics stays fixed.</small></div>
          <div className="admin-sandbox-difficulties arena-pace-select">
            <button type="button" className={draft.pace==="demo"?"active":""} onClick={()=>update("pace","demo")}><strong>Demo pace</strong><small>~2:15 · video/tuning</small></button>
            <button type="button" className={draft.pace==="production"?"active":""} onClick={()=>update("pace","production")}><strong>Live pacing</strong><small>no competitive time cap</small></button>
          </div>
        </div>
        <div className="admin-sandbox-seed-row"><label><span>Arena seed</span><input value={draft.seed} maxLength={48} onChange={e=>update("seed",e.target.value.replace(/[^a-zA-Z0-9_-]/g,""))} placeholder="e.g. bonk-battle-01"/></label><button type="button" className="btn-secondary" onClick={()=>update("seed",randomSeed())}>Random seed</button></div>
      </div>
      <div className="admin-sandbox-section">
        <span className="admin-sandbox-label">02 · Creator world palette</span>
        <p className="arena-builder-note">The creator controls the world palette and their own Orb. Arena uses broad courts, solid terrain ramps, grounded stairs, jumpable power pedestals, a multi-level central Orb dais, open ring-out arches and a live perimeter colonnade; every opponent receives a distinct generated Orb color.</p>
        <div className="admin-sandbox-presets">{GAME_STYLE_PRESETS.map(p=><button type="button" key={p.name} onClick={()=>loadStyle(p.style)}>{p.name}</button>)}<button type="button" onClick={randomize}>Surprise me ✦</button></div>
        <div className="admin-sandbox-colors">{([ ["marble","Your Orb"],["marbleSecondary","Your Orb glow"],["walls","Arena structures"],["floor","Arena floor"],["accent","Energy / hazards"] ] as const).map(([key,label])=><label key={key}><span>{label}</span><div className="admin-sandbox-color-control"><input type="color" value={HEX.test(draft[key])?draft[key]:"#5B5CF6"} onChange={e=>update(key,e.target.value.toUpperCase())}/><input value={draft[key]} maxLength={7} onChange={e=>update(key,e.target.value.toUpperCase())} placeholder="#000000"/></div></label>)}</div>
      </div>
      <div className="admin-sandbox-section admin-sandbox-output-controls">
        <div><span className="admin-sandbox-label">03 · Capture frame</span><div className="admin-sandbox-formats">{(["landscape","square","portrait"] as CaptureFormat[]).map(v=><button type="button" className={format===v?"active":""} key={v} onClick={()=>setFormat(v)}>{v==="landscape"?"16:9":v==="square"?"1:1":"9:16"}</button>)}</div></div>
        <div className="admin-sandbox-actions"><button type="button" className="btn-secondary" onClick={randomize}>Randomize</button><button type="button" className="btn-primary" disabled={!ready} onClick={generate}>{active?"Generate new match →":"Generate Arena →"}</button></div>
      </div>
      {!ready?<small className="admin-sandbox-hint">Add a seed and valid colors to launch the local Arena simulation.</small>:null}
    </div>
    {active?<div className="admin-sandbox-stage-shell"><div className="admin-sandbox-stage-toolbar"><div><strong>ARENA</strong><span>{active.playerCount} Orbs</span><span>{arenaRadiusForPlayers(active.playerCount).toFixed(1)}m footprint</span><span>{active.pace==="demo"?"demo pace":"live pacing"}</span></div><button type="button" className="btn-secondary" onClick={()=>void fullscreen()}>Fullscreen capture ↗</button></div><div ref={captureRef} className={`admin-sandbox-capture arena-capture ${format}`}><ArenaSandbox key={`${active.generation}:${format}`} playerCount={active.playerCount} style={{marble:active.marble,marbleSecondary:active.marbleSecondary,walls:active.walls,floor:active.floor,accent:active.accent}} seed={active.seed} pace={active.pace} generation={active.generation}/></div></div>:<div className="admin-sandbox-empty card arena-empty"><div className="admin-sandbox-empty-orb"/><strong>The Arena is offline.</strong><span>Choose a population, palette and seed above, then enter Arena with computer opponents, ring-outs, column zaps, ramp spikes, jumpable pedestals, double jump, crescent Blaster, super speed, health recovery and the central Orb monument.</span></div>}
  </section>;
}
