"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArenaAudioEngine } from "@/game/arenaAudio";
import { ARENA_BLASTER_LIFE_MS, ARENA_BLASTER_VOLLEY_MS, ARENA_BOMB_ARM_MS, ARENA_BOMB_DAMAGE, ARENA_BOMB_LIFETIME_MS, ARENA_CLOAK_DURATION_MS, buildArenaConfig, type ArenaPace, type ArenaPowerKind } from "@/game/arena";
import { clampPlanarSpeed, nextPlanarVelocity } from "@/game/simulation";
import { PHYSICS } from "@/game/constants";
import type { GameStyle } from "@/game/types";

type Props = { playerCount:number; style:GameStyle; seed:string; pace:ArenaPace; generation:number };
type Phase = "ready"|"countdown"|"playing"|"eliminated"|"won"|"finished";
type ControlMode = "keys"|"touch";
type Personality = "hunter"|"survivor"|"racer"|"opportunist";
type PickupKind = ArenaPowerKind | "recovery";

type OrbSim = {
  id:string; username:string; color:string; body:import("@dimforge/rapier3d-compat").RigidBody;
  mesh:import("three").Mesh; core:import("three").Mesh; label:import("three").Sprite; speedFx:import("three").Object3D;
  alive:boolean; isHuman:boolean; integrity:number; jumpReadyAt:number; airborne:boolean;
  personality:Personality; botHeading:number; botThinkAt:number;
  powerKind:ArenaPowerKind|null; powerExpiresAt:number; speedUntil:number;
  blasterActive:boolean; nextShotAt:number; doubleJumpArmed:boolean; cloakedUntil:number;
  hazardReadyAt:number; damageFlashUntil:number; deathStartedAt:number; deathUntil:number;
};

type Shockwave = { mesh:import("three").Mesh; born:number; life:number };
type Projectile = { mesh:import("three").Group; position:import("three").Vector3; velocity:import("three").Vector3; owner:OrbSim; born:number; life:number };
type Bomb = { group:import("three").Group; position:import("three").Vector3; owner:OrbSim; born:number; armedAt:number; expiresAt:number };
type Pickup = { mesh:import("three").Object3D; x:number; y:number; z:number; kind:PickupKind; readyAt:number; baseY:number };
type Pedestal = { mesh:import("three").Object3D; x:number; z:number; kind:ArenaPowerKind; readyAt:number; glow:import("three").Mesh; badge:import("three").Sprite };

const clamp=(v:number,min:number,max:number)=>Math.max(min,Math.min(max,v));
const usernames=["orbitaljup","bonkpilot","madlad","solsurfer","pixelwhale","caturday","degenqueen","mooncrate","zerogravity","mintghost","blockrunner","jupcat","helioroll","voidwalker","tokenpunk","lamportlord","orbmaxi","driftmode","neonape","cryptokite","glasscanon","solanaut","rollhard","bagholder","mevless","chainchaser","memeengine","jupiterian","vaultfox","orbitron","turbocat","liquidjup","candycloud","solstice","nightmarket","airdropkid","ghostroute","mempoolmax","mintcondition","orbitalburn"];
const POWER_META:Record<ArenaPowerKind,{label:string;color:string}> = {
  superjump:{label:"DOUBLE JUMP",color:"#FFD86B"},
  blaster:{label:"BLASTER",color:"#FF8A4C"},
  superspeed:{label:"SUPER SPEED",color:"#72F7FF"},
  cloak:{label:"CLOAK",color:"#B89CFF"},
  bomb:{label:"SKULL BOMB",color:"#FF4D5E"},
};
const PICKUP_COLOR:Record<PickupKind,string>={superjump:"#FFD86B",blaster:"#FF8A4C",superspeed:"#72F7FF",cloak:"#B89CFF",bomb:"#FF4D5E",recovery:"#FF6FAE"};

function seeded(seed:string){let h=2166136261;for(let i=0;i<seed.length;i++)h=Math.imul(h^seed.charCodeAt(i),16777619);return()=>{h+=h<<13;h^=h>>>7;h+=h<<3;h^=h>>>17;h+=h<<5;return(h>>>0)/4294967296}}
function orbColor(i:number,r:()=>number){const hue=(i*137.508+r()*28)%360;return `hsl(${hue.toFixed(0)} 90% 61%)`}
function seededNumber(seed:string){let n=0;for(let i=0;i<seed.length;i++)n=(n*31+seed.charCodeAt(i))|0;return Math.abs(n)||1}

function makeMountainRing(THREE:typeof import("three"),radius:number,seed:number,y:number,color:string){
  const segments=64,positions:number[]=[];const rand=(n:number)=>{const x=Math.sin((seed+n*19.17)*12.9898)*43758.5453;return x-Math.floor(x)};
  for(let i=0;i<segments;i++){const a0=i/segments*Math.PI*2,a1=(i+1)/segments*Math.PI*2;const h0=1.2+rand(i)*5.4+Math.pow(rand(i+177),4)*7,h1=1.2+rand(i+1)*5.4+Math.pow(rand(i+178),4)*7;const inner=radius*.94;positions.push(Math.cos(a0)*inner,y,Math.sin(a0)*inner,Math.cos(a0)*radius,y+h0,Math.sin(a0)*radius,Math.cos(a1)*radius,y+h1,Math.sin(a1)*radius,Math.cos(a0)*inner,y,Math.sin(a0)*inner,Math.cos(a1)*radius,y+h1,Math.sin(a1)*radius,Math.cos(a1)*inner,y,Math.sin(a1)*inner)}
  const g=new THREE.BufferGeometry();g.setAttribute("position",new THREE.Float32BufferAttribute(positions,3));g.computeVertexNormals();return new THREE.Mesh(g,new THREE.MeshStandardMaterial({color,roughness:.92,metalness:.08,side:THREE.DoubleSide}));
}
function makeSky(THREE:typeof import("three"),accent:string){const g=new THREE.SphereGeometry(240,40,24);const m=new THREE.ShaderMaterial({side:THREE.BackSide,depthWrite:false,uniforms:{uAccent:{value:new THREE.Color(accent)}},vertexShader:`varying vec3 vDir;void main(){vDir=normalize(position);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,fragmentShader:`varying vec3 vDir;uniform vec3 uAccent;void main(){float horizon=pow(1.0-abs(vDir.y),6.0);float zenith=smoothstep(-.15,.9,vDir.y);float aurora=smoothstep(.72,1.0,sin(vDir.x*8.0+vDir.z*10.0+vDir.y*4.0)*.5+.5)*horizon;vec3 deep=vec3(.008,.018,.08),mid=vec3(.035,.07,.22);vec3 color=mix(mid,deep,zenith);color+=uAccent*horizon*.42;color+=vec3(.04,.75,.95)*aurora*.22;gl_FragColor=vec4(color,1.0);}`});return new THREE.Mesh(g,m)}
function makeLabel(THREE:typeof import("three"),text:string,tint:string){const c=document.createElement("canvas");c.width=512;c.height=128;const x=c.getContext("2d")!;x.font="800 46px Arial";const w=Math.min(465,x.measureText(text).width+64),left=(512-w)/2;x.fillStyle="rgba(3,7,18,.72)";x.strokeStyle="rgba(255,255,255,.16)";x.lineWidth=3;x.beginPath();x.roundRect(left,22,w,72,28);x.fill();x.stroke();x.fillStyle=tint;x.beginPath();x.arc(left+29,58,8,0,Math.PI*2);x.fill();x.fillStyle="white";x.textAlign="center";x.fillText(text,256,73);const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;const s=new THREE.Sprite(new THREE.SpriteMaterial({map:t,transparent:true,depthWrite:false}));s.scale.set(3.45,.86,1);return s}
function makeOrbMaterial(THREE:typeof import("three"),primary:string,secondary:string){return new THREE.MeshPhysicalMaterial({color:primary,emissive:new THREE.Color(secondary).multiplyScalar(.52),emissiveIntensity:1.3,roughness:.1,metalness:.08,transmission:.3,thickness:1.2,clearcoat:1,clearcoatRoughness:.06,iridescence:.45,iridescenceIOR:1.62})}

function makeSpeedFx(THREE:typeof import("three"),color:string){
  const group=new THREE.Group();
  const halo=new THREE.Mesh(new THREE.TorusGeometry(PHYSICS.ballRadius*1.34,.035,10,36),new THREE.MeshBasicMaterial({color,transparent:true,opacity:.9,blending:THREE.AdditiveBlending,depthWrite:false}));
  halo.rotation.x=Math.PI/2;group.add(halo);
  const pts:number[]=[];for(let i=0;i<18;i++){const a=i/18*Math.PI*2,r=PHYSICS.ballRadius*(1.2+(i%3)*.14),y=((i%5)-2)*.12;pts.push(Math.cos(a)*r,y,Math.sin(a)*r)}
  const g=new THREE.BufferGeometry();g.setAttribute("position",new THREE.Float32BufferAttribute(pts,3));
  const sparks=new THREE.Points(g,new THREE.PointsMaterial({color,size:.095,transparent:true,opacity:.95,blending:THREE.AdditiveBlending,depthWrite:false}));group.add(sparks);group.visible=false;return group;
}
function makeOrbLogo(THREE:typeof import("three"),accent:string,scale=1){
  const group=new THREE.Group();
  const planet=new THREE.Mesh(new THREE.SphereGeometry(1.1*scale,32,22),new THREE.MeshPhysicalMaterial({color:"#AAB8FF",emissive:accent,emissiveIntensity:.55,roughness:.16,metalness:.32,transmission:.18,clearcoat:1}));
  const ring=new THREE.Mesh(new THREE.TorusGeometry(1.62*scale,.13*scale,14,56),new THREE.MeshPhysicalMaterial({color:accent,emissive:accent,emissiveIntensity:1.8,metalness:.45,roughness:.12,clearcoat:1}));
  ring.rotation.x=Math.PI*.38;ring.rotation.z=Math.PI*.14;group.add(planet,ring);return group;
}

export default function ArenaSandbox({playerCount,style,seed,pace,generation}:Props){
  const mountRef=useRef<HTMLDivElement>(null);
  const controlsRef=useRef({up:false,down:false,left:false,right:false,touchX:0,touchY:0});
  const actionRef=useRef<()=>void>(()=>undefined),startRef=useRef<()=>void>(()=>undefined);
  const [phase,setPhase]=useState<Phase>("ready"),[countdown,setCountdown]=useState(0),[survivors,setSurvivors]=useState(playerCount),[elapsed,setElapsed]=useState(0),[integrity,setIntegrity]=useState(100),[jumpCooldown,setJumpCooldown]=useState(0),[winner,setWinner]=useState<string|null>(null),[eventText,setEventText]=useState("ARENA"),[controlMode,setControlMode]=useState<ControlMode>("keys");
  const [power,setPower]=useState<ArenaPowerKind|null>(null),[powerLeft,setPowerLeft]=useState(0),[powerActive,setPowerActive]=useState(false);
  const controlModeRef=useRef<ControlMode>("keys");
  const config=useMemo(()=>buildArenaConfig({playerCount,pace,style,seed}),[playerCount,pace,style,seed]);


  useEffect(()=>{
    const mount=mountRef.current;if(!mount)return;let cancelled=false,frame=0;let cleanupThree:(()=>void)|null=null;const audio=new ArenaAudioEngine();
    setPhase("ready");setSurvivors(playerCount);setElapsed(0);setIntegrity(100);setWinner(null);setEventText("ARENA");setJumpCooldown(0);setPower(null);setPowerLeft(0);setPowerActive(false);
    if(window.matchMedia("(pointer: coarse)").matches){controlModeRef.current="touch";setControlMode("touch")}
    const onKey=(e:KeyboardEvent,down:boolean)=>{if(["ArrowUp","ArrowDown","ArrowLeft","ArrowRight","KeyW","KeyA","KeyS","KeyD","Space"].includes(e.code))e.preventDefault();if(e.code==="ArrowUp"||e.code==="KeyW")controlsRef.current.up=down;if(e.code==="ArrowDown"||e.code==="KeyS")controlsRef.current.down=down;if(e.code==="ArrowLeft"||e.code==="KeyA")controlsRef.current.left=down;if(e.code==="ArrowRight"||e.code==="KeyD")controlsRef.current.right=down;if(e.code==="Space"&&down&&!e.repeat)actionRef.current()};const kd=(e:KeyboardEvent)=>onKey(e,true),ku=(e:KeyboardEvent)=>onKey(e,false);window.addEventListener("keydown",kd,{passive:false});window.addEventListener("keyup",ku,{passive:false});

    (async()=>{
      const THREE=await import("three"),RAPIER=await import("@dimforge/rapier3d-compat");await RAPIER.init();if(cancelled)return;
      const rand=seeded(`${seed}:${generation}`),seedN=seededNumber(seed),s=config.courseScale;
      const scene=new THREE.Scene();scene.background=new THREE.Color("#050817");scene.fog=new THREE.FogExp2("#080D25",.009);
      const mobileish=window.matchMedia("(pointer: coarse)").matches||window.innerWidth<800;const camera=new THREE.PerspectiveCamera(mobileish?60:55,1,.08,550);const renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:"high-performance"});renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.1;renderer.setPixelRatio(Math.min(devicePixelRatio||1,mobileish?1.25:1.6));renderer.shadowMap.enabled=true;mount.innerHTML="";mount.appendChild(renderer.domElement);
      scene.add(new THREE.HemisphereLight("#8CF6FF","#07091B",2.1));const sun=new THREE.DirectionalLight("#D9E9FF",3.45);sun.position.set(-18,28,14);sun.castShadow=true;scene.add(sun);const rim=new THREE.DirectionalLight(style.accent,2.75);rim.position.set(16,10,-16);scene.add(rim);scene.add(makeSky(THREE,style.accent));scene.add(makeMountainRing(THREE,56*s,seedN,-3.2,"#10183C"),makeMountainRing(THREE,69*s,seedN+991,-3.5,"#09112B"));
      const world=new RAPIER.World({x:0,y:-PHYSICS.gravity,z:0});
      const terrainMat=new THREE.MeshPhysicalMaterial({color:style.floor,emissive:new THREE.Color(style.marbleSecondary).multiplyScalar(.12),emissiveIntensity:.65,roughness:.28,metalness:.25,transmission:.13,clearcoat:1,clearcoatRoughness:.13});
      const staticMeshes:import("three").Object3D[]=[];
      const quat=(rx:number,ry:number,rz:number)=>{const q=new THREE.Quaternion().setFromEuler(new THREE.Euler(rx,ry,rz));return{x:q.x,y:q.y,z:q.z,w:q.w}};
      function addSurface(name:string,pos:{x:number;y:number;z:number},size:{x:number;y:number;z:number},rot={x:0,y:0,z:0},color?:string){
        const desc=RAPIER.RigidBodyDesc.fixed().setTranslation(pos.x,pos.y,pos.z).setRotation(quat(rot.x,rot.y,rot.z));const body=world.createRigidBody(desc);world.createCollider(RAPIER.ColliderDesc.cuboid(size.x/2,size.y/2,size.z/2).setFriction(.58).setRestitution(.045),body);
        const mat=color?new THREE.MeshPhysicalMaterial({color,emissive:new THREE.Color(style.accent).multiplyScalar(.08),roughness:.26,metalness:.3,clearcoat:1}):terrainMat;const mesh=new THREE.Mesh(new THREE.BoxGeometry(size.x,size.y,size.z),mat);mesh.name=name;mesh.position.set(pos.x,pos.y,pos.z);mesh.rotation.set(rot.x,rot.y,rot.z);mesh.receiveShadow=true;mesh.castShadow=true;scene.add(mesh);staticMeshes.push(mesh);return body;
      }
      function addRamp(name:string,x:number,z:number,axis:"x"|"z",dir:number,width=5*s,length=8*s,height=1.7*s){
        // A true solid wedge: convex-hull physics prevents the Orb from ever entering an "under-ramp" cavity.
        const L=length,W=width,H=height;
        const vertices=new Float32Array([
          -L/2,0,-W/2, -L/2,0,W/2,
           L/2,0,-W/2,  L/2,0,W/2,
           L/2,H,-W/2,  L/2,H,W/2,
        ]);
        const indices=new Uint32Array([
          0,2,3, 0,3,1,       // floor
          0,1,5, 0,5,4,       // sloped top
          2,4,5, 2,5,3,       // tall end
          0,4,2,               // side
          1,3,5,               // side
        ]);
        const ry=axis==="x"?(dir>0?0:Math.PI):(dir>0?-Math.PI/2:Math.PI/2),q=quat(0,ry,0);
        const body=world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x,0,z).setRotation(q));
        const solid=RAPIER.ColliderDesc.convexHull(vertices);
        world.createCollider((solid??RAPIER.ColliderDesc.trimesh(vertices,indices)).setFriction(.62).setRestitution(.035),body);
        const g=new THREE.BufferGeometry();g.setAttribute("position",new THREE.BufferAttribute(vertices,3));g.setIndex(new THREE.BufferAttribute(indices,1));g.computeVertexNormals();
        const mesh=new THREE.Mesh(g,terrainMat);mesh.name=name;mesh.position.set(x,0,z);mesh.rotation.y=ry;mesh.castShadow=true;mesh.receiveShadow=true;scene.add(mesh);staticMeshes.push(mesh);return body;
      }
      function addPedestal(x:number,z:number,kind:ArenaPowerKind){
        const accent=POWER_META[kind].color;
        const body=world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x,.72,z));world.createCollider(RAPIER.ColliderDesc.cylinder(.72,1.75*s).setFriction(.52).setRestitution(.06),body);
        const mesh=new THREE.Mesh(new THREE.CylinderGeometry(1.75*s,2.05*s,1.44,24),new THREE.MeshPhysicalMaterial({color:style.walls,emissive:accent,emissiveIntensity:.24,roughness:.22,metalness:.34,clearcoat:1}));mesh.position.set(x,.72,z);mesh.castShadow=true;mesh.receiveShadow=true;scene.add(mesh);
        const glow=new THREE.Mesh(new THREE.TorusGeometry(1.08*s,.12*s,12,48),new THREE.MeshBasicMaterial({color:accent,transparent:true,opacity:.96,blending:THREE.AdditiveBlending,depthWrite:false}));glow.position.set(x,1.58,z);glow.rotation.x=Math.PI/2;scene.add(glow);
        const halo=new THREE.Mesh(new THREE.CylinderGeometry(.82*s,.82*s,1.2,40,1,true),new THREE.MeshBasicMaterial({color:accent,transparent:true,opacity:.08,side:THREE.DoubleSide,blending:THREE.AdditiveBlending,depthWrite:false}));halo.position.set(x,2.08,z);scene.add(halo);
        const beacon=new THREE.Mesh(new THREE.CylinderGeometry(.10*s,.58*s,5.4,24,1,true),new THREE.MeshBasicMaterial({color:accent,transparent:true,opacity:.22,side:THREE.DoubleSide,blending:THREE.AdditiveBlending,depthWrite:false}));beacon.position.set(x,4.0,z);scene.add(beacon);
        const crown=new THREE.Mesh(new THREE.SphereGeometry(.24*s,16,12),new THREE.MeshBasicMaterial({color:accent,transparent:true,opacity:.95,blending:THREE.AdditiveBlending,depthWrite:false}));crown.position.set(x,2.05,z);scene.add(crown);
        const pedestalLight=new THREE.PointLight(accent,4.2,11*s,2);pedestalLight.position.set(x,2.35,z);scene.add(pedestalLight);
        const badge=makeLabel(THREE,kind==="superjump"?"↑ DOUBLE JUMP":kind==="blaster"?"●●● BLASTER":kind==="superspeed"?"» SUPER SPEED":kind==="cloak"?"◌ CLOAK":"☠ SKULL BOMB",accent);badge.position.set(x,5.15,z);badge.scale.multiplyScalar(.95);scene.add(badge);
        glow.userData.halo=halo;glow.userData.beacon=beacon;glow.userData.crown=crown;glow.userData.light=pedestalLight;
        return {mesh,x,z,kind,readyAt:0,glow,badge} satisfies Pedestal;
      }

      const arenaHalf=30*s;
      {const body=world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0,-.28,0));world.createCollider(RAPIER.ColliderDesc.cylinder(.28,arenaHalf).setFriction(.58).setRestitution(.045),body);const mesh=new THREE.Mesh(new THREE.CylinderGeometry(arenaHalf,arenaHalf,.56,96),terrainMat);mesh.name="coliseum floor";mesh.position.set(0,-.28,0);mesh.receiveShadow=true;mesh.castShadow=true;scene.add(mesh);staticMeshes.push(mesh)}
      // The circular floor ends at the colonnade, so every open arch is a real ring-out lane.
      const d=15.5*s;[[-d,0,"x",1],[d,0,"x",-1],[0,-d,"z",1],[0,d,"z",-1]].forEach(([x,z,axis,dir],i)=>addRamp(`outer bank ${i}`,x as number,z as number,axis as "x"|"z",dir as number,6.5*s,10*s,2.2*s));
      // Keep the four diagonal approaches visually clean. Earlier raised ridge blocks intersected
      // nearby ramps/dais sightlines and read like accidental mesh overlap, so the continuous
      // coliseum floor now carries these approaches without an extra obstacle layer.
      // Central multi-level orbital dais with four stair approaches.
      addSurface("dais lower",{x:0,y:.28,z:0},{x:16*s,y:.55,z:16*s});
      addSurface("dais middle",{x:0,y:.78,z:0},{x:11.5*s,y:.55,z:11.5*s});
      addSurface("dais upper",{x:0,y:1.32,z:0},{x:7.2*s,y:.55,z:7.2*s});
      const stepDepth=1.05*s,stepWidth=5.4*s;
      // Every stair is filled all the way to the floor. No hollow/floating step undersides.
      for(let side=0;side<4;side++)for(let i=0;i<4;i++){
        const top=.34+i*.28,offset=(8.4-i*1.05)*s,isNS=side<2;
        const x=isNS?0:(side===2?-offset:offset),z=isNS?(side===0?-offset:offset):0;
        addSurface(`dais stair ${side}-${i}`,{x,y:top/2,z},{x:isNS?stepWidth:stepDepth,y:top,z:isNS?stepDepth:stepWidth});
      }
      // The colonnade itself is the perimeter. Open arches between columns are real ring-out lanes.
      const wallR=arenaHalf*.965,columnCount=32,columnR=wallR*1.025;
      const columnHazards:{x:number;z:number;r:number}[]=[];
      const spikeHazards:{x:number;y:number;z:number}[]=[];
      const columnMat=new THREE.MeshPhysicalMaterial({color:style.walls,emissive:new THREE.Color(style.accent).multiplyScalar(.12),emissiveIntensity:.62,roughness:.2,metalness:.28,transmission:.07,clearcoat:1});
      const trimMat=new THREE.MeshPhysicalMaterial({color:style.marbleSecondary,emissive:new THREE.Color(style.accent).multiplyScalar(.18),emissiveIntensity:.72,roughness:.18,metalness:.34,clearcoat:1});
      for(let i=0;i<columnCount;i++){
        const a=(i/columnCount)*Math.PI*2,x=Math.cos(a)*columnR,z=Math.sin(a)*columnR;
        const rb=world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x,2.1,z));
        world.createCollider(RAPIER.ColliderDesc.cylinder(2.1,.74*s).setFriction(.42).setRestitution(.34),rb);
        columnHazards.push({x,z,r:.74*s});
        const group=new THREE.Group();group.position.set(x,0,z);group.rotation.y=-a;
        const base=new THREE.Mesh(new THREE.CylinderGeometry(.66*s,.74*s,.24,28),trimMat);base.position.y=.12;
        const foot=new THREE.Mesh(new THREE.CylinderGeometry(.5*s,.61*s,.22,28),columnMat);foot.position.y=.35;
        const shaft=new THREE.Mesh(new THREE.CylinderGeometry(.34*s,.39*s,3.35,28),columnMat);shaft.position.y=2.13;
        const collar=new THREE.Mesh(new THREE.CylinderGeometry(.5*s,.42*s,.2,28),columnMat);collar.position.y=3.9;
        const capital=new THREE.Mesh(new THREE.CylinderGeometry(.72*s,.56*s,.3,28),trimMat);capital.position.y=4.15;
        for(const part of [base,foot,shaft,collar,capital]){part.castShadow=true;part.receiveShadow=true;group.add(part)}
        scene.add(group);
      }
      // Two opposite ramps carry one lightweight instanced spike rail on each edge.
      const spikeGeo=new THREE.ConeGeometry(.18*s,.48*s,6),spikeMat=new THREE.MeshPhysicalMaterial({color:"#A8EFFF",emissive:"#45DFFF",emissiveIntensity:1.1,roughness:.2,metalness:.45}),spikeMesh=new THREE.InstancedMesh(spikeGeo,spikeMat,32),spikeMatrix=new THREE.Matrix4();let spikeIndex=0;
      for(const [cx,dir] of [[-d,1],[d,-1]] as const)for(const side of [-1,1])for(let j=0;j<8;j++){const x=cx-4.25*s+j*(8.5*s/7),z=side*3.25*s,rampT=clamp(dir>0?(x-(cx-5*s))/(10*s):((cx+5*s)-x)/(10*s),0,1),y=rampT*2.2*s+.24*s;spikeHazards.push({x,y,z});spikeMatrix.makeTranslation(x,y,z);spikeMesh.setMatrixAt(spikeIndex++,spikeMatrix)}
      spikeMesh.count=spikeIndex;scene.add(spikeMesh);
      // Bankable impact columns.
      const bumperMat=new THREE.MeshPhysicalMaterial({color:style.marbleSecondary,emissive:style.accent,emissiveIntensity:1.2,roughness:.16,metalness:.36,clearcoat:1});
      [[-9,-16],[9,-16],[-16,-9],[16,9],[-9,16],[9,16],[16,-9],[-16,9]].forEach(([xx,zz])=>{const x=xx*s,z=zz*s,body=world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x,1.05,z));world.createCollider(RAPIER.ColliderDesc.cylinder(1.05,.72*s).setRestitution(.7).setFriction(.2),body);const mesh=new THREE.Mesh(new THREE.CylinderGeometry(.72*s,.94*s,2.1,28),bumperMat);mesh.position.set(x,1.05,z);mesh.castShadow=true;scene.add(mesh)});
      // Orbs identity sculpture: a landmark, not a hazard.
      const logo=makeOrbLogo(THREE,style.accent,1.5*s);logo.position.set(0,4.15,0);scene.add(logo);
      [[-21,-21],[21,-21],[-21,21],[21,21]].forEach(([xx,zz])=>{const mini=makeOrbLogo(THREE,style.accent,.55*s);mini.position.set(xx*s,2.2,zz*s);mini.rotation.y=rand()*Math.PI*2;scene.add(mini)});
      // Reachable pedestal objectives. Landing on top grants a temporary power.
      const pedestalKinds:ArenaPowerKind[]=["superjump","blaster","cloak","bomb","superspeed","blaster"];
      const pedestals:Pedestal[]=[[-14,-7],[14,-7],[-14,7],[14,7],[0,-15],[0,15]].map(([xx,zz],i)=>addPedestal(xx*s,zz*s,pedestalKinds[i]!));

      // Maze-style pickup beacons. Pickups are authored onto known flat surfaces rather than using hard-coded arbitrary Y values.
      const pickups:Pickup[]=[];
      function addPickup(rx:number,rz:number,surfaceY:number,kind:PickupKind){
        const color=PICKUP_COLOR[kind],group=new THREE.Group();
        const disc=new THREE.Mesh(new THREE.RingGeometry(.72*s,1.12*s,48),new THREE.MeshBasicMaterial({color,transparent:true,opacity:.52,side:THREE.DoubleSide,blending:THREE.AdditiveBlending,depthWrite:false}));disc.rotation.x=-Math.PI/2;group.add(disc);
        const halo=new THREE.Mesh(new THREE.CylinderGeometry(.92*s,.92*s,1.1,40,1,true),new THREE.MeshBasicMaterial({color,transparent:true,opacity:.085,side:THREE.DoubleSide,blending:THREE.AdditiveBlending,depthWrite:false}));halo.position.y=.52;group.add(halo);
        const beacon=new THREE.Mesh(new THREE.CylinderGeometry(.08*s,.42*s,3.2,24,1,true),new THREE.MeshBasicMaterial({color,transparent:true,opacity:.06,side:THREE.DoubleSide,blending:THREE.AdditiveBlending,depthWrite:false}));beacon.position.y=1.6;group.add(beacon);
        if(kind==="recovery"){
          const plusMat=new THREE.MeshBasicMaterial({color:"#59FF88",transparent:true,opacity:.98});
          const a=new THREE.Mesh(new THREE.BoxGeometry(.16*s,.88*s,.12*s),plusMat),b=new THREE.Mesh(new THREE.BoxGeometry(.88*s,.16*s,.12*s),plusMat);
          a.position.y=1.25;b.position.y=1.25;group.add(a,b);
        }
        if(kind==="superjump"){
          const arrowMat=new THREE.MeshBasicMaterial({color:"#FFF5A8",transparent:true,opacity:.98});
          const shaft=new THREE.Mesh(new THREE.BoxGeometry(.16*s,.72*s,.12*s),arrowMat);shaft.position.y=1.25;
          const head=new THREE.Mesh(new THREE.ConeGeometry(.32*s,.48*s,4),arrowMat);head.position.y=1.82;head.rotation.z=Math.PI;group.add(shaft,head);
        }
        if(kind==="blaster"){
          const bulletMat=new THREE.MeshBasicMaterial({color:"#FFE3C2"});
          const bullet=new THREE.Mesh(new THREE.CapsuleGeometry(.13*s,.42*s,4,8),bulletMat);bullet.position.y=1.45;bullet.rotation.z=Math.PI/2;group.add(bullet);
        }
        if(kind==="superspeed"){
          const speedMat=new THREE.MeshBasicMaterial({color:"#D9FFFF",transparent:true,opacity:.98});
          for(let i=0;i<3;i++){const bolt=new THREE.Mesh(new THREE.ConeGeometry(.18*s,.64*s,4),speedMat);bolt.position.set((i-1)*.32*s,1.48,-i*.04);bolt.rotation.z=-Math.PI/2;group.add(bolt)}
        }
        const badgeText=kind==="recovery"?"+ HEALTH":kind==="superjump"?"↑ DOUBLE JUMP":kind==="blaster"?"● BLASTER":"» SUPER SPEED";
        const badge=makeLabel(THREE,badgeText,color);badge.position.set(0,2.35,0);badge.scale.multiplyScalar(.9);group.add(badge);
        const y=surfaceY+.16;group.position.set(rx*s,y,rz*s);scene.add(group);pickups.push({mesh:group,x:rx*s,y,z:rz*s,kind,readyAt:0,baseY:y});
      }
      // Every free ring has one unambiguous purpose. Locations are clear of ramps, stairs and pedestal footprints.
      addPickup(-21,-8,0,"superjump"); addPickup(21,8,0,"superjump");
      addPickup(-8,-21,0,"blaster"); addPickup(8,21,0,"blaster");
      addPickup(-20,14,0,"superspeed"); addPickup(20,-14,0,"superspeed");
      addPickup(-16,-17,0,"recovery"); addPickup(16,17,0,"recovery");
      // Elevated rings live only on the broad upper dais, never on stair geometry.
      addPickup(-2.4,0,1.61,"superjump"); addPickup(2.4,0,1.61,"blaster"); addPickup(0,2.4,1.61,"superspeed");


      const orbGeo=new THREE.SphereGeometry(PHYSICS.ballRadius,40,28),coreGeo=new THREE.SphereGeometry(PHYSICS.ballRadius*.69,28,18);const orbs:OrbSim[]=[];
      // Spawn on clear outer courts, phased away from the four cardinal ramp approaches. Alternating rings preserve spacing at high populations.
      for(let i=0;i<playerCount;i++){const human=i===0,a=Math.PI/4+(i/playerCount)*Math.PI*2,spawnR=(i%2===0?23.5:21.5)*s,x=Math.cos(a)*spawnR,z=Math.sin(a)*spawnR,color=human?style.marble:orbColor(i,rand),secondary=human?style.marbleSecondary:color;const body=world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(x,1.05,z).setLinearDamping(PHYSICS.linearDamping).setAngularDamping(PHYSICS.angularDamping).setCcdEnabled(true));world.createCollider(RAPIER.ColliderDesc.ball(PHYSICS.ballRadius).setDensity(1).setFriction(PHYSICS.friction).setRestitution(.14),body);const mat=makeOrbMaterial(THREE,color,secondary),mesh=new THREE.Mesh(orbGeo,mat);mesh.castShadow=true;const core=new THREE.Mesh(coreGeo,new THREE.MeshBasicMaterial({color:secondary,transparent:true,opacity:.27,blending:THREE.AdditiveBlending,depthWrite:false}));mesh.add(core);const speedFx=makeSpeedFx(THREE,POWER_META.superspeed.color);mesh.add(speedFx);const label=makeLabel(THREE,human?"@you":`@${usernames[(i-1)%usernames.length]}`,color);label.position.set(0,1.2,0);mesh.add(label);scene.add(mesh);orbs.push({id:`orb-${i}`,username:human?"@you":`@${usernames[(i-1)%usernames.length]}`,color,body,mesh,core,label,speedFx,alive:true,isHuman:human,integrity:100,jumpReadyAt:0,airborne:false,personality:(["hunter","survivor","racer","opportunist"] as Personality[])[i%4]!,botHeading:rand()*Math.PI*2,botThinkAt:0,powerKind:null,powerExpiresAt:0,speedUntil:0,blasterActive:false,nextShotAt:0,doubleJumpArmed:false,cloakedUntil:0,hazardReadyAt:0,damageFlashUntil:0,deathStartedAt:0,deathUntil:0})}

      const human=orbs[0]!;const shocks:Shockwave[]=[];const projectiles:Projectile[]=[];const bombs:Bomb[]=[];const pairHits=new Map<string,number>();let cameraShake=0,lastFacing=new THREE.Vector3(0,0,-1),matchStart=0,live=false,resolved=false,lastUi=0,acc=0,prev=performance.now(),simTime=0;

      // Opening-frame hardening: pre-allocate the two effects that can otherwise create short-lived
      // WebGL/GC allocation spikes during the first firefight.
      const bulletGeometry=new THREE.SphereGeometry(.16*s,10,8);
      const bulletMaterial=new THREE.MeshBasicMaterial({color:POWER_META.blaster.color,transparent:true,opacity:.95,blending:THREE.AdditiveBlending,depthWrite:false});
      const bulletPool:import("three").Group[]=[];
      const makeBulletMesh=()=>{const group=new THREE.Group();for(let i=0;i<3;i++)group.add(new THREE.Mesh(bulletGeometry,bulletMaterial));group.visible=false;scene.add(group);return group};
      for(let i=0;i<48;i++)bulletPool.push(makeBulletMesh());
      const acquireBullet=()=>{const group=bulletPool.pop()??makeBulletMesh();group.visible=true;return group};
      const releaseBullet=(group:import("three").Group)=>{group.visible=false;group.position.set(0,-1000,0);for(const child of group.children)child.scale.setScalar(1);bulletPool.push(group)};
      const bombPool:import("three").Group[]=[];
      const makeBombVisual=()=>{const group=new THREE.Group(),orb=new THREE.Mesh(new THREE.SphereGeometry(.30*s,12,9),new THREE.MeshBasicMaterial({color:"#24040A",transparent:true,opacity:.94})),ring=new THREE.Mesh(new THREE.TorusGeometry(.62*s,.055*s,8,28),new THREE.MeshBasicMaterial({color:POWER_META.bomb.color,transparent:true,opacity:.72,blending:THREE.AdditiveBlending,depthWrite:false}));ring.rotation.x=Math.PI/2;const skull=makeLabel(THREE,"☠",POWER_META.bomb.color);skull.scale.set(.72,.36,1);skull.position.y=.62*s;group.add(orb,ring,skull);group.visible=false;scene.add(group);return group};
      const acquireBomb=()=>{const group=bombPool.pop()??makeBombVisual();group.visible=true;return group};
      const releaseBomb=(group:import("three").Group)=>{group.visible=false;group.position.set(0,-1000,0);bombPool.push(group)};

      const shockGeometry=new THREE.SphereGeometry(.5,20,12);
      const shockPool:import("three").Mesh[]=[];
      const makeShockMesh=()=>{const mat=new THREE.MeshBasicMaterial({color:"#FFFFFF",transparent:true,opacity:0,wireframe:true}),mesh=new THREE.Mesh(shockGeometry,mat);mesh.visible=false;scene.add(mesh);return mesh};
      for(let i=0;i<24;i++)shockPool.push(makeShockMesh());
      const acquireShock=(color:string)=>{const mesh=shockPool.pop()??makeShockMesh(),mat=mesh.material as import("three").MeshBasicMaterial;mat.color.set(color);mat.opacity=.48;mesh.scale.setScalar(1);mesh.visible=true;return mesh};
      const releaseShock=(mesh:import("three").Mesh)=>{mesh.visible=false;mesh.position.set(0,-1000,0);shockPool.push(mesh)};
      const burst=(x:number,y:number,z:number,power:number,color:string)=>{const mesh=acquireShock(color);mesh.position.set(x,y,z);shocks.push({mesh,born:performance.now(),life:260+power*180});cameraShake=Math.max(cameraShake,.04+power*.12)};
      const eliminate=(o:OrbSim,reason="SHATTERED")=>{if(!o.alive)return;const now=performance.now();o.alive=false;o.body.setEnabled(false);o.deathStartedAt=now;o.deathUntil=now+330;o.damageFlashUntil=now+330;const alive=orbs.filter(v=>v.alive);setSurvivors(alive.length);if(o.isHuman){setPhase("eliminated");setEventText(reason==="FELL"?"YOU FELL · SPECTATING":"YOU'RE OUT · SPECTATING");reason==="FELL"?audio.fall():audio.eliminated()}else setEventText(`${o.username} ${reason}`);if(alive.length<=1&&!resolved){resolved=true;const w=alive[0];setWinner(w?.username??null);if(w?.isHuman){setPhase("won");audio.victory()}else setPhase("finished");setEventText(w?`${w.username} WINS`:"MATCH COMPLETE")}};
      const grounded=(o:OrbSim)=>{const v=o.body.linvel();return Math.abs(v.y)<.72};
      const clearPower=(o:OrbSim)=>{if(o.powerKind==="cloak")o.cloakedUntil=0;o.powerKind=null;o.powerExpiresAt=0;o.blasterActive=false;o.doubleJumpArmed=false;if(o.isHuman)setPowerActive(false)};
      const grantPower=(o:OrbSim,kind:ArenaPowerKind,now:number)=>{o.powerKind=kind;o.cloakedUntil=0;o.powerExpiresAt=now+config.weaponLifetimeMs;if(o.isHuman){setPower(kind);setPowerLeft(1);setPowerActive(false);setEventText(`${POWER_META[kind].label} LOADED · SPACE TO USE`)}audio.powerPickup(kind)};
      const normalJump=(o:OrbSim,mult=1)=>{const now=performance.now();if(now<o.jumpReadyAt||!grounded(o))return false;const v=o.body.linvel();o.body.setLinvel({x:v.x,y:config.jumpImpulse*mult,z:v.z},true);o.jumpReadyAt=now+config.jumpCooldownMs;o.airborne=true;if(o.isHuman)audio.jump();return true};
      const useAction=(o:OrbSim)=>{if(!live||!o.alive)return;const now=performance.now();if(o.powerKind&&now>=o.powerExpiresAt)clearPower(o);const kind=o.powerKind;if(!kind){normalJump(o);return}
        if(kind==="superjump"){
          if(grounded(o)){if(normalJump(o,1.18)){o.doubleJumpArmed=true;audio.powerUse(kind);if(o.isHuman)setEventText("DOUBLE JUMP · PRESS AGAIN IN AIR")}}
          else if(o.doubleJumpArmed){const v=o.body.linvel();o.body.setLinvel({x:v.x,y:config.jumpImpulse*1.42,z:v.z},true);o.doubleJumpArmed=false;audio.powerUse(kind);clearPower(o);if(o.isHuman)setEventText("DOUBLE JUMP")}
        }
        else if(kind==="blaster"){
          if(o.blasterActive){normalJump(o)}
          else{o.blasterActive=true;o.nextShotAt=0;o.powerExpiresAt=now+config.weaponLifetimeMs;audio.powerUse(kind);if(o.isHuman){setPowerActive(true);setEventText("BLASTER ACTIVE · 8 SECONDS · SPACE TO JUMP")}}
        }
        else if(kind==="superspeed"){
          if(now<o.speedUntil){normalJump(o)}
          else{o.speedUntil=now+config.weaponLifetimeMs;o.powerExpiresAt=o.speedUntil;audio.powerUse(kind);if(o.isHuman){setPowerActive(true);setEventText("SUPER SPEED · 8 SECONDS · INVULNERABLE · SPACE TO JUMP")}}
        }
        else if(kind==="cloak"){
          if(now<o.cloakedUntil){normalJump(o)}
          else{o.cloakedUntil=now+ARENA_CLOAK_DURATION_MS;o.powerExpiresAt=o.cloakedUntil;audio.powerUse(kind);if(o.isHuman){setPowerActive(true);setEventText("CLOAKED · 12 SECONDS · SPACE TO JUMP")}}
        }
        else if(kind==="bomb"){
          if(!grounded(o))return;dropBomb(o,now);audio.powerUse(kind);clearPower(o);if(o.isHuman){setPower(null);setPowerLeft(0);setEventText("SKULL BOMB DROPPED · ARMS IN 1 SECOND")}
        }
        if(o.isHuman){setPower(o.powerKind);setPowerLeft(o.powerKind?clamp((o.powerExpiresAt-now)/(o.powerKind==="cloak"&&o.cloakedUntil>now?ARENA_CLOAK_DURATION_MS:config.weaponLifetimeMs),0,1):0)}
      };actionRef.current=()=>useAction(human);
      const start=()=>{if(live)return;setPhase("countdown");audio.startMusic();let n=3;setCountdown(n);const timer=window.setInterval(()=>{n-=1;setCountdown(n);if(n<=0){window.clearInterval(timer);setCountdown(0);setPhase("playing");setEventText("FIGHT FOR THE POWER RINGS");matchStart=performance.now();live=true}},650)};startRef.current=start;

      function facingFor(o:OrbSim){const v=o.body.linvel(),speed=Math.hypot(v.x,v.z);if(speed>.55)return new THREE.Vector3(v.x/speed,0,v.z/speed);if(o.isHuman)return lastFacing.clone();return new THREE.Vector3(Math.cos(o.botHeading),0,Math.sin(o.botHeading))}
      function fireBullet(o:OrbSim,now:number){const dir=facingFor(o),p=o.body.translation(),mesh=acquireBullet();const pos=new THREE.Vector3(p.x+dir.x*.98,p.y+.06,p.z+dir.z*.98);mesh.position.copy(pos);projectiles.push({mesh,position:pos,velocity:dir.multiplyScalar(14),owner:o,born:now,life:ARENA_BLASTER_LIFE_MS});audio.blasterShot()}
      function updateProjectiles(now:number,dt:number){for(const o of orbs){if(o.alive&&o.blasterActive&&o.powerKind==="blaster"&&now<o.powerExpiresAt&&now>=o.nextShotAt){fireBullet(o,now);o.nextShotAt=now+ARENA_BLASTER_VOLLEY_MS}}for(let i=projectiles.length-1;i>=0;i--){const b=projectiles[i]!,age=now-b.born;if(age>b.life){releaseBullet(b.mesh);projectiles.splice(i,1);continue}b.position.addScaledVector(b.velocity,dt);b.mesh.position.copy(b.position);const dir=b.velocity.clone().normalize(),perp=new THREE.Vector3(-dir.z,0,dir.x),progress=clamp(age/b.life,0,1),spread=clamp(.95*s,.75,1.6)*progress,size=1+progress*1.35;[-spread,0,spread].forEach((lateral,index)=>{const dot=b.mesh.children[index]!;dot.position.copy(perp).multiplyScalar(lateral);dot.scale.setScalar(size)});let hit=false;for(const target of orbs){if(!target.alive||target===b.owner)continue;const p=target.body.translation(),dotRadius=clamp(.25*s,.22,.5);let touches=false;for(const lateral of [-spread,0,spread]){const lx=b.position.x+perp.x*lateral,lz=b.position.z+perp.z*lateral;if(Math.hypot(p.x-lx,p.y-b.position.y,p.z-lz)<=PHYSICS.ballRadius+dotRadius){touches=true;break}}if(!touches)continue;const invulnerable=now<target.speedUntil,damage=invulnerable?0:8;target.integrity=Math.max(0,target.integrity-damage);target.damageFlashUntil=now+155;if(!invulnerable)target.body.applyImpulse({x:dir.x*.82,y:.09,z:dir.z*.82},true);burst(p.x,p.y,p.z,.45,POWER_META.blaster.color);if(target.integrity<=0)eliminate(target,"BLASTED");hit=true;break}if(hit){releaseBullet(b.mesh);projectiles.splice(i,1)}}}
      function dropBomb(o:OrbSim,now:number){const dir=facingFor(o),p=o.body.translation(),group=acquireBomb(),position=new THREE.Vector3(p.x-dir.x*.92,Math.max(.12,p.y-.34),p.z-dir.z*.92);group.position.copy(position);bombs.push({group,position,owner:o,born:now,armedAt:now+ARENA_BOMB_ARM_MS,expiresAt:now+ARENA_BOMB_LIFETIME_MS})}
      function updateBombs(now:number){for(let i=bombs.length-1;i>=0;i--){const bomb=bombs[i]!,left=clamp((bomb.expiresAt-now)/ARENA_BOMB_LIFETIME_MS,0,1);bomb.group.visible=true;bomb.group.scale.setScalar(.96+Math.sin(now*.01)*.08);for(const child of bomb.group.children){if((child as import("three").Mesh).isMesh)((child as import("three").Mesh).material as import("three").MeshBasicMaterial).opacity=now>=bomb.armedAt?Math.max(.18,.92*left):.38;else if((child as import("three").Sprite).isSprite)((child as import("three").Sprite).material as import("three").SpriteMaterial).opacity=Math.max(.2,left)};if(now>=bomb.expiresAt){releaseBomb(bomb.group);bombs.splice(i,1);continue}if(now<bomb.armedAt)continue;let target:OrbSim|undefined;for(const o of orbs){if(!o.alive||o===bomb.owner)continue;const p=o.body.translation();if(Math.abs(p.y-bomb.position.y)<=1.25&&Math.hypot(p.x-bomb.position.x,p.z-bomb.position.z)<=clamp(.82*s,.7,1.25)+PHYSICS.ballRadius){target=o;break}}if(!target)continue;const p=target.body.translation(),invulnerable=now<target.speedUntil,damage=invulnerable?0:ARENA_BOMB_DAMAGE;if(!invulnerable)target.integrity=Math.max(0,target.integrity-damage);target.damageFlashUntil=now+220;const dx=p.x-bomb.position.x,dz=p.z-bomb.position.z,mag=Math.hypot(dx,dz)||1;if(!invulnerable)target.body.applyImpulse({x:dx/mag*2.35,y:.78,z:dz/mag*2.35},true);burst(bomb.position.x,bomb.position.y,bomb.position.z,1.1,POWER_META.bomb.color);audio.bombExplosion();if(target.integrity<=0)eliminate(target,"BOMBED");releaseBomb(bomb.group);bombs.splice(i,1)}}
      function handleImpacts(now:number){
        const cellSize=1.2;
        const buckets=new Map<string,OrbSim[]>();
        for(const o of orbs){
          if(!o.alive)continue;
          const p=o.body.translation();
          const key=`${Math.floor(p.x/cellSize)},${Math.floor(p.z/cellSize)}`;
          const bucket=buckets.get(key);
          if(bucket)bucket.push(o);else buckets.set(key,[o]);
        }
        const seen=new Set<string>();
        for(const [key,bucket] of buckets){
          const [cx,cz]=key.split(",").map(Number);
          for(let dx=-1;dx<=1;dx++)for(let dz=-1;dz<=1;dz++){
            const other=buckets.get(`${cx!+dx},${cz!+dz}`);
            if(!other)continue;
            for(const a of bucket)for(const b of other){
              if(a===b)continue;
              const pk=a.id<b.id?`${a.id}:${b.id}`:`${b.id}:${a.id}`;
              if(seen.has(pk))continue;
              seen.add(pk);
              const pa=a.body.translation(),pb=b.body.translation();
              const nx=pb.x-pa.x,nz=pb.z-pa.z,dist=Math.hypot(nx,nz);
              if(dist>PHYSICS.ballRadius*2.38||dist<.001)continue;
              const va=a.body.linvel(),vb=b.body.linvel(),ux=nx/dist,uz=nz/dist;
              const closing=Math.max(0,-((vb.x-va.x)*ux+(vb.z-va.z)*uz));
              const last=pairHits.get(pk)??0;
              if(closing<1.25||now-last<190)continue;
              pairHits.set(pk,now);
              const sa=Math.hypot(va.x,va.z),sb=Math.hypot(vb.x,vb.z);
              let attacker=a,target=b;
              if(sb>sa){attacker=b;target=a}
              const speeding=now<attacker.speedUntil,targetInvulnerable=now<target.speedUntil;
              const power=clamp((closing-1.1)/4.2,0,1);
              let damage=targetInvulnerable?0:clamp((closing-1.2)*config.impactDamageScale,0,4.2);
              if(speeding&&!targetInvulnerable)damage=clamp(18+power*12,18,30);
              target.integrity=Math.max(0,target.integrity-damage);if(damage>0)target.damageFlashUntil=now+155;
              const direction=target===b?1:-1;
              const knock=targetInvulnerable?.12:(.34+power*.72)*(speeding?2.2:1);
              if(!targetInvulnerable)target.body.applyImpulse({x:ux*direction*knock,y:.06+power*.2,z:uz*direction*knock},true);
              burst((pa.x+pb.x)/2,(pa.y+pb.y)/2,(pa.z+pb.z)/2,speeding?1:power,target.color);
              audio.bump(speeding?1:.28+power*.5);
              if(speeding&&!targetInvulnerable)setEventText(`${attacker.username} SUPER SPEED HIT · ${Math.round(damage)} DAMAGE`);
              if(a.isHuman||b.isHuman)setIntegrity(Math.round(human.integrity));
              if(target.integrity<=0)eliminate(target);
            }
          }
        }
      }
      function updatePickups(now:number,matchElapsed:number){const respawnFactor=matchElapsed>=config.overchargeAt ? 0.38 : matchElapsed>=config.suddenDeathAt ? 0.58 : 1;for(const pickup of pickups){pickup.mesh.rotation.y+=.018;pickup.mesh.position.y=pickup.baseY+Math.abs(Math.sin(now*.003+pickup.x))*.08;const ready=now>=pickup.readyAt;pickup.mesh.visible=ready;if(!ready)continue;for(const o of orbs){if(!o.alive)continue;const p=o.body.translation();if(Math.hypot(p.x-pickup.x,p.z-pickup.z)>1.5*s||Math.abs(p.y-pickup.y)>2.4)continue;pickup.readyAt=now+config.ringRespawnMs*respawnFactor;pickup.mesh.visible=false;if(pickup.kind==="recovery"){const before=o.integrity;o.integrity=Math.min(100,o.integrity+config.recoveryAmount);audio.recover();if(o.isHuman){setIntegrity(Math.round(o.integrity));setEventText(`HEALTH +${Math.round(o.integrity-before)}`)}}else grantPower(o,pickup.kind,now);break}}
        for(const ped of pedestals){ped.glow.rotation.z+=.025;const ready=now>=ped.readyAt;ped.glow.visible=ready;ped.badge.visible=ready;if(ped.glow.userData.halo)ped.glow.userData.halo.visible=ready;if(ped.glow.userData.beacon)ped.glow.userData.beacon.visible=ready;if(ped.glow.userData.crown)ped.glow.userData.crown.visible=ready;if(ped.glow.userData.light)ped.glow.userData.light.visible=ready;if(!ready)continue;for(const o of orbs){if(!o.alive||o.powerKind)continue;const p=o.body.translation();if(Math.hypot(p.x-ped.x,p.z-ped.z)>1.55*s||p.y<1.35)continue;ped.readyAt=now+config.pedestalRespawnMs*respawnFactor;ped.glow.visible=false;ped.badge.visible=false;if(ped.glow.userData.halo)ped.glow.userData.halo.visible=false;if(ped.glow.userData.beacon)ped.glow.userData.beacon.visible=false;if(ped.glow.userData.crown)ped.glow.userData.crown.visible=false;if(ped.glow.userData.light)ped.glow.userData.light.visible=false;grantPower(o,ped.kind,now);break}}
      }
      function botInput(o:OrbSim,nowSec:number,nowMs:number){const p=o.body.translation();if(o.powerKind&&nowMs<o.powerExpiresAt){let nearest=99;for(const e of orbs){if(e===o||!e.alive)continue;const ep=e.body.translation();nearest=Math.min(nearest,Math.hypot(ep.x-p.x,ep.z-p.z))}if(nearest<5.5&&rand()<.08)useAction(o)}if(nowSec>=o.botThinkAt){let tx=0,tz=0,best=Infinity;const candidates:{x:number;z:number;score:number}[]=[];for(const pick of pickups){if(nowMs<pick.readyAt)continue;if(pick.kind==="recovery"&&o.integrity>62)continue;const dd=Math.hypot(pick.x-p.x,pick.z-p.z);candidates.push({x:pick.x,z:pick.z,score:dd*(pick.kind==="recovery" ? .62 : 1)})}for(const ped of pedestals){if(nowMs<ped.readyAt)continue;const dd=Math.hypot(ped.x-p.x,ped.z-p.z);candidates.push({x:ped.x,z:ped.z,score:dd*.9})}for(const c of candidates)if(c.score<best){best=c.score;tx=c.x;tz=c.z}if(!candidates.length||o.powerKind){const enemies=orbs.filter(v=>v.alive&&v!==o);let target=enemies[0];best=Infinity;for(const e of enemies){const ep=e.body.translation(),dd=Math.hypot(ep.x-p.x,ep.z-p.z);if(dd<best){best=dd;target=e}}if(target){const tp=target.body.translation();tx=tp.x;tz=tp.z}}o.botHeading=Math.atan2(tz-p.z,tx-p.x)+(rand()-.5)*(o.personality==="hunter" ? .18 : .45);o.botThinkAt=nowSec+.18+rand()*.32;if(rand()<.055)normalJump(o)}return{x:Math.cos(o.botHeading),y:-Math.sin(o.botHeading)}}
      const resize=()=>{const r=mount.getBoundingClientRect();renderer.setSize(Math.max(1,r.width),Math.max(1,r.height),false);camera.aspect=r.width/Math.max(1,r.height);camera.updateProjectionMatrix()};const ro=new ResizeObserver(resize);ro.observe(mount);resize();
      // Compile all scene materials while the READY card is still covering the Arena. This moves
      // shader/program creation out of the opening seconds of actual play.
      renderer.compile(scene,camera);
      renderer.render(scene,camera);
      const look=new THREE.Vector3(),desired=new THREE.Vector3();
      const render=(ms:number)=>{if(cancelled)return;frame=requestAnimationFrame(render);const dt=Math.min(.05,(ms-prev)/1000);prev=ms;const matchElapsed=live?(ms-matchStart)/1000:0;if(live&&!resolved){setElapsed(matchElapsed);const alive=orbs.filter(o=>o.alive).length;audio.setIntensity(clamp(Math.max(config.maxSeconds>0?matchElapsed/config.maxSeconds:0,1-alive/playerCount),0,1));if(matchElapsed>config.overchargeAt)setEventText("OVERCHARGE · POWER RINGS RECHARGE FAST");else if(matchElapsed>config.suddenDeathAt)setEventText("POWER SURGE · RINGS RECHARGE FASTER");acc+=dt;while(acc>=PHYSICS.fixedStep){simTime+=PHYSICS.fixedStep;for(const o of orbs){if(!o.alive)continue;let ix=0,iy=0;if(o.isHuman){const k=controlsRef.current;let sx=(k.right?1:0)-(k.left?1:0),sy=(k.up?1:0)-(k.down?1:0);if(controlModeRef.current==="touch"){sx=k.touchX;sy=k.touchY}const rightX=-lastFacing.z,rightZ=lastFacing.x,worldX=rightX*sx+lastFacing.x*sy,worldZ=rightZ*sx+lastFacing.z*sy;ix=worldX;iy=-worldZ;if(Math.hypot(worldX,worldZ)>.2){const desiredHeading=new THREE.Vector3(worldX,0,worldZ).normalize();lastFacing.lerp(desiredHeading,.026).normalize()}}else{const b=botInput(o,simTime,performance.now());ix=b.x;iy=b.y}const v=o.body.linvel(),profile=o.isHuman&&controlModeRef.current==="keys"?"desktop":"mobile",speedMul=performance.now()<o.speedUntil?5:1,steerBase=nextPlanarVelocity({x:v.x/speedMul,z:v.z/speedMul},ix,iy,profile),steer={x:steerBase.x*speedMul,z:steerBase.z*speedMul};o.body.setLinvel({x:steer.x,y:v.y,z:steer.z},true)}world.step();const now=performance.now();handleImpacts(now);updatePickups(now,matchElapsed);updateProjectiles(now,PHYSICS.fixedStep);updateBombs(now);for(const o of orbs){if(!o.alive)continue;const v=o.body.linvel(),profile=o.isHuman&&controlModeRef.current==="keys"?"desktop":"mobile",speedMul=now<o.speedUntil?5:1,baseClamp=clampPlanarSpeed({x:v.x/speedMul,z:v.z/speedMul},profile),cl={x:baseClamp.x*speedMul,z:baseClamp.z*speedMul};if(cl.x!==v.x||cl.z!==v.z)o.body.setLinvel({x:cl.x,y:v.y,z:cl.z},true);const p=o.body.translation();if(o.airborne&&Math.abs(v.y)<.55)o.airborne=false;if(o.powerKind&&now>=o.powerExpiresAt){clearPower(o);if(o.isHuman){setPower(null);setPowerLeft(0);setEventText("POWER EXPIRED · FIND ANOTHER")}}if(p.y<-3.6){eliminate(o,"FELL");continue}
            if(now>=o.hazardReadyAt){
              let hazardHit=false;
              if(Math.hypot(p.x,p.z)>arenaHalf*.84)for(const h of columnHazards){const dx=p.x-h.x,dz=p.z-h.z;if(Math.hypot(dx,dz)>h.r+PHYSICS.ballRadius*.7)continue;hazardHit=true;o.hazardReadyAt=now+850;const invulnerable=now<o.speedUntil;if(!invulnerable){o.integrity=Math.max(0,o.integrity-3);o.damageFlashUntil=now+155;const mag=Math.max(.001,Math.hypot(p.x,p.z));o.body.applyImpulse({x:-p.x/mag*.72,y:.12,z:-p.z/mag*.72},true);audio.zap();if(o.integrity<=0)eliminate(o,"ZAPPED")}break}
              if(!hazardHit&&now>=o.hazardReadyAt)for(const h of spikeHazards){const dx=p.x-h.x,dy=p.y-h.y,dz=p.z-h.z,contactRadius=PHYSICS.ballRadius+.2*s;if(dx*dx+dy*dy+dz*dz>contactRadius*contactRadius)continue;o.hazardReadyAt=now+850;const invulnerable=now<o.speedUntil;if(!invulnerable){o.integrity=Math.max(0,o.integrity-4);o.damageFlashUntil=now+155;const side=p.z>=h.z?1:-1;o.body.applyImpulse({x:0,y:.12,z:side*.72},true);audio.bump(.72);if(o.integrity<=0)eliminate(o,"SPIKED")}break}
            }}acc-=PHYSICS.fixedStep}if(config.maxSeconds>0&&matchElapsed>=config.maxSeconds&&!resolved){const aliveOrbs=orbs.filter(o=>o.alive).sort((a,b)=>b.integrity-a.integrity);aliveOrbs.slice(1).forEach(o=>eliminate(o,"DEMO TIME"))}if(ms-lastUi>90){lastUi=ms;setSurvivors(orbs.filter(o=>o.alive).length);setIntegrity(Math.round(human.integrity));setJumpCooldown(clamp((human.jumpReadyAt-performance.now())/config.jumpCooldownMs,0,1));setPower(human.powerKind);setPowerLeft(human.powerKind?clamp((human.powerExpiresAt-performance.now())/config.weaponLifetimeMs,0,1):0)}}
        for(const o of orbs){const mat=o.mesh.material as import("three").MeshPhysicalMaterial;if(!o.alive){if(o.deathUntil>ms){const t=clamp((ms-o.deathStartedAt)/Math.max(1,o.deathUntil-o.deathStartedAt),0,1);o.mesh.visible=true;o.mesh.scale.setScalar(1+t*.48);mat.emissive.set("#FFFFFF");mat.emissiveIntensity=2.5*(1-t)+.4;o.core.scale.setScalar(1+t*.7);o.label.visible=false}else{o.mesh.visible=false;o.label.visible=false}continue}o.mesh.visible=true;o.label.visible=true;o.mesh.scale.setScalar(1);const p=o.body.translation(),q=o.body.rotation();o.mesh.position.set(p.x,p.y,p.z);o.mesh.quaternion.set(q.x,q.y,q.z,q.w);o.label.quaternion.copy(camera.quaternion);const damage=1-o.integrity/100,speeding=performance.now()<o.speedUntil,cloaked=performance.now()<o.cloakedUntil,flashing=ms<o.damageFlashUntil;if(cloaked&&!o.isHuman){o.mesh.visible=false;o.label.visible=false;continue}if(cloaked&&o.isHuman){mat.transparent=true;mat.opacity=.42;mat.emissive.set(POWER_META.cloak.color);mat.emissiveIntensity=2.2;o.label.visible=false}else{mat.transparent=false;mat.opacity=1;if(flashing){mat.emissive.set("#FFFFFF");mat.emissiveIntensity=3.1}else{mat.emissive.set(o.color).multiplyScalar(.52);mat.emissiveIntensity=1.05+damage*1.5+(o.powerKind ? .7 : 0)+(speeding?2.4:0)}}mat.metalness=speeding?.72:.08;mat.roughness=speeding?.035:.1;o.speedFx.visible=speeding&&!cloaked;if(speeding&&!cloaked){o.speedFx.rotation.x+=dt*2.8;o.speedFx.rotation.y+=dt*5.5;o.speedFx.scale.setScalar(.94+Math.sin(ms*.018)*.12)}o.core.scale.setScalar(1+damage*.18+(o.powerKind ? .08 : 0)+(speeding?.13:0))}
        logo.rotation.y+=dt*.16;
        for(let i=shocks.length-1;i>=0;i--){const sh=shocks[i]!,age=ms-sh.born,t=age/sh.life;if(t>=1){releaseShock(sh.mesh);shocks.splice(i,1)}else{sh.mesh.scale.setScalar(1+t*3.6);(sh.mesh.material as import("three").MeshBasicMaterial).opacity=.44*(1-t)}}
        const focus=human.alive?human:orbs.find(o=>o.alive);if(focus){const p=focus.body.translation(),v=focus.body.linvel(),speed=Math.hypot(v.x,v.z),back=mobileish?10.8:10,height=mobileish?6.2:5.7;desired.set(p.x-lastFacing.x*back,p.y+height,p.z-lastFacing.z*back);if(cameraShake>.002){desired.x+=(rand()-.5)*cameraShake;desired.y+=(rand()-.5)*cameraShake;desired.z+=(rand()-.5)*cameraShake;cameraShake*=.86}camera.position.lerp(desired,1-Math.exp(-dt*6.5));look.set(p.x+lastFacing.x*(2.5+speed*.16),p.y+.55,p.z+lastFacing.z*(2.5+speed*.16));camera.lookAt(look)}renderer.render(scene,camera)};render(performance.now());
      cleanupThree=()=>{cancelAnimationFrame(frame);ro.disconnect();audio.stop();orbGeo.dispose();coreGeo.dispose();bulletGeometry.dispose();bulletMaterial.dispose();shockGeometry.dispose();for(const mesh of shockPool)(mesh.material as import("three").Material).dispose();for(const sh of shocks)(sh.mesh.material as import("three").Material).dispose();terrainMat.dispose();renderer.dispose();mount.innerHTML=""};
    })();
    return()=>{cancelled=true;cleanupThree?.();audio.stop();window.removeEventListener("keydown",kd);window.removeEventListener("keyup",ku)};
  },[config,generation,playerCount,seed,style]);

  const touchStart=useCallback((e:React.PointerEvent<HTMLDivElement>)=>e.currentTarget.setPointerCapture(e.pointerId),[]);const touchMove=useCallback((e:React.PointerEvent<HTMLDivElement>)=>{if(!e.currentTarget.hasPointerCapture(e.pointerId))return;const r=e.currentTarget.getBoundingClientRect(),x=(e.clientX-(r.left+r.width/2))/(r.width*.36),y=(e.clientY-(r.top+r.height/2))/(r.height*.36),m=Math.max(1,Math.hypot(x,y));controlsRef.current.touchX=clamp(x/m,-1,1);controlsRef.current.touchY=clamp(-y/m,-1,1)},[]);const touchEnd=useCallback((e:React.PointerEvent<HTMLDivElement>)=>{controlsRef.current.touchX=0;controlsRef.current.touchY=0;try{e.currentTarget.releasePointerCapture(e.pointerId)}catch{}},[]);
  const left=config.maxSeconds>0?Math.max(0,config.maxSeconds-elapsed):Math.max(0,elapsed),powerMeta=power?POWER_META[power]:null;
  return <div className="arena-sandbox-game arena-course-game">
    <div ref={mountRef} className="arena-sandbox-canvas"/>
    <div className="arena-hud arena-hud-top">
      <div><span>ORBS REMAIN</span><strong>{survivors}</strong></div>
      <div className="arena-event"><strong>{eventText}</strong><small>{Math.floor(left/60)}:{String(Math.floor(left%60)).padStart(2,"0")} · {config.maxSeconds>0?"LEFT":"ELAPSED"}</small></div>
    </div>
    <div className="arena-vitals">
      <span>HEALTH {integrity}%</span><div className="arena-meter"><i style={{transform:`scaleX(${integrity/100})`}}/></div>
      {powerMeta?<><span style={{color:powerMeta.color}}>{powerMeta.label}</span><div className="arena-meter arena-power-meter"><i style={{transform:`scaleX(${powerLeft})`,background:powerMeta.color}}/></div></>:null}
    </div>
    {phase==="ready"?<div className="arena-center-card"><span>ADMIN ONLY</span><h3>ARENA</h3><p>Every ring has one job: gold ↑ = double jump · orange ●●● = blaster spray · violet ◌ = cloak · red ☠ = skull bomb · cyan » = 5× invulnerable super speed · pink/green + = health.</p><button className="btn-primary" onClick={()=>startRef.current()}>Enter Arena →</button></div>:null}
    {phase==="countdown"?<div className="arena-countdown">{countdown||"GO"}</div>:null}
    {(phase==="eliminated"||phase==="finished"||phase==="won")?<div className="arena-result-card"><span>{phase==="eliminated"?"SPECTATING":"MATCH COMPLETE"}</span><h3>{phase==="won"?"YOU WIN":winner?`${winner} WINS`:"YOU'RE OUT"}</h3><p>{phase==="eliminated"?`${survivors} Orbs remain. Watch them fight for the remaining powers.`:"Last Orb standing takes the prize."}</p></div>:null}
    {phase==="playing"?<div className="arena-jump-wrap"><button className={`arena-jump ${power?"armed":""}`} style={powerMeta?{borderColor:powerMeta.color,boxShadow:`0 0 28px ${powerMeta.color}55`}:undefined} onClick={()=>actionRef.current()} disabled={(!power||powerActive)&&jumpCooldown>0.02}><span>{powerActive?"JUMP":powerMeta?(power==="blaster"?"FIRE":power==="superspeed"?"SPEED":power==="cloak"?"CLOAK":power==="bomb"?"DROP":powerMeta.label.split(" ")[0]):"JUMP"}</span><i style={{transform:`scaleX(${power?powerLeft:1-jumpCooldown})`,background:powerMeta?.color}}/></button></div>:null}
    {phase==="playing"&&controlMode==="touch"?<div className="game-touch-pad arena-touch" onPointerDown={touchStart} onPointerMove={touchMove} onPointerUp={touchEnd} onPointerCancel={touchEnd}><div className="game-touch-knob"/></div>:null}
    <div className="arena-control-hint"><span className="arena-desktop-hint">ARROWS / WASD · ROLL &nbsp;&nbsp; SPACE · {powerActive?"JUMP":powerMeta?"USE POWER":"JUMP"}</span><span className="arena-mobile-hint">ROLL · {powerActive?"JUMP":powerMeta?"USE POWER":"JUMP"} · ↑ JUMP · ●●● BLASTER · ◌ CLOAK · ☠ BOMB · » SPEED · + HEALTH</span></div>
  </div>;
}
