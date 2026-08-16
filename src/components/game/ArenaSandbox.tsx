"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArenaAudioEngine } from "@/game/arenaAudio";
import { buildArenaConfig, type ArenaPace, type ArenaPowerKind } from "@/game/arena";
import { clampPlanarSpeed, nextPlanarVelocity } from "@/game/simulation";
import { PHYSICS } from "@/game/constants";
import type { GameStyle } from "@/game/types";

type Props = { playerCount:number; style:GameStyle; seed:string; pace:ArenaPace; generation:number };
type Phase = "ready"|"countdown"|"playing"|"eliminated"|"won"|"finished";
type ControlMode = "keys"|"touch"|"sensor";
type Personality = "hunter"|"survivor"|"racer"|"opportunist";
type PickupKind = ArenaPowerKind | "recovery";

type OrbSim = {
  id:string; username:string; color:string; body:import("@dimforge/rapier3d-compat").RigidBody;
  mesh:import("three").Mesh; core:import("three").Mesh; label:import("three").Sprite;
  alive:boolean; isHuman:boolean; integrity:number; jumpReadyAt:number; airborne:boolean;
  personality:Personality; botHeading:number; botThinkAt:number;
  powerKind:ArenaPowerKind|null; powerExpiresAt:number; kineticUntil:number; shieldUntil:number;
  slamArmed:boolean; slamStartedAt:number;
};

type Shockwave = { mesh:import("three").Mesh; born:number; life:number };
type Pickup = { mesh:import("three").Object3D; x:number; y:number; z:number; kind:PickupKind; readyAt:number; baseY:number };
type Pedestal = { mesh:import("three").Object3D; x:number; z:number; readyAt:number; glow:import("three").Mesh };

const clamp=(v:number,min:number,max:number)=>Math.max(min,Math.min(max,v));
const usernames=["orbitaljup","bonkpilot","madlad","solsurfer","pixelwhale","caturday","degenqueen","mooncrate","zerogravity","mintghost","blockrunner","jupcat","helioroll","voidwalker","tokenpunk","lamportlord","orbmaxi","driftmode","neonape","cryptokite","glasscanon","solanaut","rollhard","bagholder","mevless","chainchaser","memeengine","jupiterian","vaultfox","orbitron","turbocat","liquidjup","candycloud","solstice","nightmarket","airdropkid","ghostroute","mempoolmax","mintcondition","orbitalburn"];
const POWER_META:Record<ArenaPowerKind,{label:string;color:string}> = {
  kinetic:{label:"KINETIC BLAST",color:"#5EF7FF"},
  slam:{label:"GROUND SLAM",color:"#B56CFF"},
  shield:{label:"PULSE SHIELD",color:"#7CFFB2"},
  superjump:{label:"SUPER JUMP",color:"#FFD86B"},
};
const PICKUP_COLOR:Record<PickupKind,string>={kinetic:"#5EF7FF",slam:"#B56CFF",shield:"#7CFFB2",superjump:"#FFD86B",recovery:"#FF6FAE"};

function seeded(seed:string){let h=2166136261;for(let i=0;i<seed.length;i++)h=Math.imul(h^seed.charCodeAt(i),16777619);return()=>{h+=h<<13;h^=h>>>7;h+=h<<3;h^=h>>>17;h+=h<<5;return(h>>>0)/4294967296}}
function orbColor(i:number,r:()=>number){const hue=(i*137.508+r()*28)%360;return `hsl(${hue.toFixed(0)} 90% 61%)`}
function seededNumber(seed:string){let n=0;for(let i=0;i<seed.length;i++)n=(n*31+seed.charCodeAt(i))|0;return Math.abs(n)||1}

function makeMountainRing(THREE:typeof import("three"),radius:number,seed:number,y:number,color:string){
  const segments=64,positions:number[]=[];const rand=(n:number)=>{const x=Math.sin((seed+n*19.17)*12.9898)*43758.5453;return x-Math.floor(x)};
  for(let i=0;i<segments;i++){const a0=i/segments*Math.PI*2,a1=(i+1)/segments*Math.PI*2;const h0=1.2+rand(i)*5.4+Math.pow(rand(i+177),4)*7,h1=1.2+rand(i+1)*5.4+Math.pow(rand(i+178),4)*7;const inner=radius*.94;positions.push(Math.cos(a0)*inner,y,Math.sin(a0)*inner,Math.cos(a0)*radius,y+h0,Math.sin(a0)*radius,Math.cos(a1)*radius,y+h1,Math.sin(a1)*radius,Math.cos(a0)*inner,y,Math.sin(a0)*inner,Math.cos(a1)*radius,y+h1,Math.sin(a1)*radius,Math.cos(a1)*inner,y,Math.sin(a1)*inner)}
  const g=new THREE.BufferGeometry();g.setAttribute("position",new THREE.Float32BufferAttribute(positions,3));g.computeVertexNormals();return new THREE.Mesh(g,new THREE.MeshStandardMaterial({color,roughness:.92,metalness:.08,side:THREE.DoubleSide}));
}
function makeSky(THREE:typeof import("three"),accent:string){const g=new THREE.SphereGeometry(240,40,24);const m=new THREE.ShaderMaterial({side:THREE.BackSide,depthWrite:false,uniforms:{uAccent:{value:new THREE.Color(accent)}},vertexShader:`varying vec3 vDir;void main(){vDir=normalize(position);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,fragmentShader:`varying vec3 vDir;uniform vec3 uAccent;void main(){float horizon=pow(1.0-abs(vDir.y),6.0);float zenith=smoothstep(-.15,.9,vDir.y);float aurora=smoothstep(.72,1.0,sin(vDir.x*8.0+vDir.z*10.0+vDir.y*4.0)*.5+.5)*horizon;vec3 deep=vec3(.008,.018,.08),mid=vec3(.035,.07,.22);vec3 color=mix(mid,deep,zenith);color+=uAccent*horizon*.42;color+=vec3(.04,.75,.95)*aurora*.22;gl_FragColor=vec4(color,1.0);}`});return new THREE.Mesh(g,m)}
function makeLabel(THREE:typeof import("three"),text:string,tint:string){const c=document.createElement("canvas");c.width=512;c.height=128;const x=c.getContext("2d")!;x.font="800 46px Arial";const w=Math.min(465,x.measureText(text).width+64),left=(512-w)/2;x.fillStyle="rgba(3,7,18,.72)";x.strokeStyle="rgba(255,255,255,.16)";x.lineWidth=3;x.beginPath();x.roundRect(left,22,w,72,28);x.fill();x.stroke();x.fillStyle=tint;x.beginPath();x.arc(left+29,58,8,0,Math.PI*2);x.fill();x.fillStyle="white";x.textAlign="center";x.fillText(text,256,73);const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;const s=new THREE.Sprite(new THREE.SpriteMaterial({map:t,transparent:true,depthWrite:false}));s.scale.set(2.8,.7,1);return s}
function makeOrbMaterial(THREE:typeof import("three"),primary:string,secondary:string){return new THREE.MeshPhysicalMaterial({color:primary,emissive:new THREE.Color(secondary).multiplyScalar(.34),emissiveIntensity:1.05,roughness:.1,metalness:.08,transmission:.3,thickness:1.2,clearcoat:1,clearcoatRoughness:.06,iridescence:.45,iridescenceIOR:1.62})}
function makeOrbLogo(THREE:typeof import("three"),accent:string,scale=1){
  const group=new THREE.Group();
  const planet=new THREE.Mesh(new THREE.SphereGeometry(1.1*scale,32,22),new THREE.MeshPhysicalMaterial({color:"#AAB8FF",emissive:accent,emissiveIntensity:.55,roughness:.16,metalness:.32,transmission:.18,clearcoat:1}));
  const ring=new THREE.Mesh(new THREE.TorusGeometry(1.62*scale,.13*scale,14,56),new THREE.MeshPhysicalMaterial({color:accent,emissive:accent,emissiveIntensity:1.8,metalness:.45,roughness:.12,clearcoat:1}));
  ring.rotation.x=Math.PI*.38;ring.rotation.z=Math.PI*.14;group.add(planet,ring);return group;
}

export default function ArenaSandbox({playerCount,style,seed,pace,generation}:Props){
  const mountRef=useRef<HTMLDivElement>(null);
  const controlsRef=useRef({up:false,down:false,left:false,right:false,touchX:0,touchY:0});
  const sensorRef=useRef({active:false,beta:0,gamma:0,neutralBeta:0,neutralGamma:0});
  const actionRef=useRef<()=>void>(()=>undefined),startRef=useRef<()=>void>(()=>undefined);
  const [phase,setPhase]=useState<Phase>("ready"),[countdown,setCountdown]=useState(0),[survivors,setSurvivors]=useState(playerCount),[elapsed,setElapsed]=useState(0),[integrity,setIntegrity]=useState(100),[jumpCooldown,setJumpCooldown]=useState(0),[winner,setWinner]=useState<string|null>(null),[eventText,setEventText]=useState("LAST ORB STANDING"),[controlMode,setControlMode]=useState<ControlMode>("keys"),[sensorAvailable,setSensorAvailable]=useState(false);
  const [power,setPower]=useState<ArenaPowerKind|null>(null),[powerLeft,setPowerLeft]=useState(0);
  const controlModeRef=useRef<ControlMode>("keys");
  const config=useMemo(()=>buildArenaConfig({playerCount,pace,style,seed}),[playerCount,pace,style,seed]);

  const requestMotion=useCallback(async()=>{const E=window.DeviceOrientationEvent as typeof DeviceOrientationEvent&{requestPermission?:()=>Promise<"granted"|"denied">};try{if(typeof E.requestPermission==="function"&&(await E.requestPermission())!=="granted")return;sensorRef.current.neutralBeta=sensorRef.current.beta;sensorRef.current.neutralGamma=sensorRef.current.gamma;sensorRef.current.active=true;controlModeRef.current="sensor";setControlMode("sensor")}catch{}},[]);

  useEffect(()=>{
    const mount=mountRef.current;if(!mount)return;let cancelled=false,frame=0;let cleanupThree:(()=>void)|null=null;const audio=new ArenaAudioEngine();
    setPhase("ready");setSurvivors(playerCount);setElapsed(0);setIntegrity(100);setWinner(null);setEventText("LAST ORB STANDING");setJumpCooldown(0);setPower(null);setPowerLeft(0);
    const orientation=(e:DeviceOrientationEvent)=>{sensorRef.current.beta=e.beta??0;sensorRef.current.gamma=e.gamma??0};window.addEventListener("deviceorientation",orientation);if("DeviceOrientationEvent" in window)setSensorAvailable(true);if(window.matchMedia("(pointer: coarse)").matches){controlModeRef.current="touch";setControlMode("touch")}
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
      function addRamp(name:string,x:number,z:number,axis:"x"|"z",dir:number,width=5*s,length=8*s,height=1.7*s){const angle=Math.atan2(height,length),y=.22+height/2;addSurface(name,{x,y,z},{x:axis==="x"?length:width,y:.4,z:axis==="z"?length:width},{x:axis==="z"?-dir*angle:0,y:0,z:axis==="x"?dir*angle:0})}
      function addPedestal(x:number,z:number,accent:string){
        const body=world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x,.72,z));world.createCollider(RAPIER.ColliderDesc.cylinder(.72,1.6*s).setFriction(.52).setRestitution(.06),body);
        const mesh=new THREE.Mesh(new THREE.CylinderGeometry(1.6*s,1.9*s,1.44,20),new THREE.MeshPhysicalMaterial({color:style.walls,emissive:accent,emissiveIntensity:.24,roughness:.22,metalness:.34,clearcoat:1}));mesh.position.set(x,.72,z);mesh.castShadow=true;mesh.receiveShadow=true;scene.add(mesh);
        const glow=new THREE.Mesh(new THREE.TorusGeometry(.95*s,.11*s,12,40),new THREE.MeshBasicMaterial({color:accent,transparent:true,opacity:.78}));glow.position.set(x,1.55,z);glow.rotation.x=Math.PI/2;scene.add(glow);return {mesh,x,z,readyAt:0,glow} satisfies Pedestal;
      }

      const arenaHalf=30*s;addSurface("coliseum floor",{x:0,y:-.28,z:0},{x:arenaHalf*2,y:.56,z:arenaHalf*2});
      // Broad banks / bowls. Continuous ground means traversal, not ring-out survival.
      const d=15.5*s;[[-d,0,"x",1],[d,0,"x",-1],[0,-d,"z",1],[0,d,"z",-1]].forEach(([x,z,axis,dir],i)=>addRamp(`outer bank ${i}`,x as number,z as number,axis as "x"|"z",dir as number,6.5*s,10*s,2.2*s));
      [[-11,-11,Math.PI/4],[11,-11,-Math.PI/4],[-11,11,-Math.PI/4],[11,11,Math.PI/4]].forEach(([x,z,r],i)=>addSurface(`diagonal ridge ${i}`,{x:x*s,y:.55,z:z*s},{x:10*s,y:.62,z:4*s},{x:0,y:r,z:0}));
      // Central multi-level orbital dais with four stair approaches.
      addSurface("dais lower",{x:0,y:.28,z:0},{x:16*s,y:.55,z:16*s});
      addSurface("dais middle",{x:0,y:.78,z:0},{x:11.5*s,y:.55,z:11.5*s});
      addSurface("dais upper",{x:0,y:1.32,z:0},{x:7.2*s,y:.55,z:7.2*s});
      const stepDepth=1.05*s,stepWidth=5.4*s;
      for(let side=0;side<4;side++)for(let i=0;i<4;i++){const h=.18+i*.28,offset=(8.4-i*1.05)*s;const isNS=side<2,x=isNS?0:(side===2?-offset:offset),z=isNS?(side===0?-offset:offset):0;addSurface(`dais stair ${side}-${i}`,{x,y:h,z},{x:isNS?stepWidth:stepDepth,y:.32,z:isNS?stepDepth:stepWidth})}
      // Coliseum containment.
      const wallMat=new THREE.MeshPhysicalMaterial({color:style.walls,emissive:new THREE.Color(style.accent).multiplyScalar(.13),emissiveIntensity:.7,roughness:.22,metalness:.3,transmission:.08,clearcoat:1});const wallR=arenaHalf*.965,wallSegments=44;
      for(let i=0;i<wallSegments;i++){const a=(i/wallSegments)*Math.PI*2,x=Math.cos(a)*wallR,z=Math.sin(a)*wallR,len=2*Math.PI*wallR/wallSegments*1.07,q=new THREE.Quaternion().setFromEuler(new THREE.Euler(0,-a,0));const rb=world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x,1.9,z).setRotation({x:q.x,y:q.y,z:q.z,w:q.w}));world.createCollider(RAPIER.ColliderDesc.cuboid(len/2,2.1,.5*s).setFriction(.48).setRestitution(.28),rb);const mesh=new THREE.Mesh(new THREE.BoxGeometry(len,4.2,1*s),wallMat);mesh.position.set(x,1.9,z);mesh.rotation.y=-a;mesh.castShadow=true;scene.add(mesh)}
      // Bankable impact columns.
      const bumperMat=new THREE.MeshPhysicalMaterial({color:style.marbleSecondary,emissive:style.accent,emissiveIntensity:1.2,roughness:.16,metalness:.36,clearcoat:1});
      [[-9,-16],[9,-16],[-16,-9],[16,9],[-9,16],[9,16],[16,-9],[-16,9]].forEach(([xx,zz])=>{const x=xx*s,z=zz*s,body=world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x,1.05,z));world.createCollider(RAPIER.ColliderDesc.cylinder(1.05,.72*s).setRestitution(.7).setFriction(.2),body);const mesh=new THREE.Mesh(new THREE.CylinderGeometry(.72*s,.94*s,2.1,8),bumperMat);mesh.position.set(x,1.05,z);mesh.castShadow=true;scene.add(mesh)});
      // Orbs identity sculpture: a landmark, not a hazard.
      const logo=makeOrbLogo(THREE,style.accent,1.5*s);logo.position.set(0,4.15,0);scene.add(logo);
      [[-21,-21],[21,-21],[-21,21],[21,21]].forEach(([xx,zz])=>{const mini=makeOrbLogo(THREE,style.accent,.55*s);mini.position.set(xx*s,2.2,zz*s);mini.rotation.y=rand()*Math.PI*2;scene.add(mini)});
      // Reachable pedestal objectives. Landing on top grants a random temporary weapon.
      const pedestals:Pedestal[]=[[-12,-5],[12,-5],[-12,5],[12,5],[0,-13],[0,13]].map(([xx,zz],i)=>addPedestal(xx*s,zz*s,[POWER_META.kinetic.color,POWER_META.slam.color,POWER_META.shield.color,POWER_META.superjump.color][i%4]!));
      // Free rings: weapons + pink recovery rings.
      const pickups:Pickup[]=[];const pickupDefs:[number,number,number,PickupKind][]=[[-19,-3,.7,"kinetic"],[19,3,.7,"slam"],[-3,-19,.7,"shield"],[3,19,.7,"superjump"],[-15,14,.7,"recovery"],[15,-14,.7,"recovery"],[-7,0,2.2,"kinetic"],[7,0,2.2,"superjump"]];
      for(const [rx,rz,ry,kind] of pickupDefs){const color=PICKUP_COLOR[kind],group=new THREE.Group(),ring=new THREE.Mesh(new THREE.TorusGeometry(1.15*s,.14*s,12,44),new THREE.MeshPhysicalMaterial({color,emissive:color,emissiveIntensity:2.35,roughness:.1,metalness:.3,transparent:true,opacity:.94,clearcoat:1}));ring.rotation.x=Math.PI/2;group.add(ring);if(kind==="recovery"){const plusMat=new THREE.MeshBasicMaterial({color,transparent:true,opacity:.92});const a=new THREE.Mesh(new THREE.BoxGeometry(.18,1.05,.16),plusMat),b=new THREE.Mesh(new THREE.BoxGeometry(1.05,.18,.16),plusMat);a.position.y=.02;b.position.y=.02;group.add(a,b)}group.position.set(rx*s,ry,rz*s);scene.add(group);pickups.push({mesh:group,x:rx*s,y:ry,z:rz*s,kind,readyAt:0,baseY:ry})}

      const orbGeo=new THREE.SphereGeometry(PHYSICS.ballRadius,40,28),coreGeo=new THREE.SphereGeometry(PHYSICS.ballRadius*.69,28,18);const orbs:OrbSim[]=[];
      const spawnR=18*s;for(let i=0;i<playerCount;i++){const human=i===0,a=(i/playerCount)*Math.PI*2+(rand()-.5)*.18,ring=spawnR+(i%3-1)*1.2*s,x=Math.cos(a)*ring,z=Math.sin(a)*ring,color=human?style.marble:orbColor(i,rand),secondary=human?style.marbleSecondary:color;const body=world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(x,1.05,z).setLinearDamping(PHYSICS.linearDamping).setAngularDamping(PHYSICS.angularDamping).setCcdEnabled(true));world.createCollider(RAPIER.ColliderDesc.ball(PHYSICS.ballRadius).setDensity(1).setFriction(PHYSICS.friction).setRestitution(.14),body);const mat=makeOrbMaterial(THREE,color,secondary),mesh=new THREE.Mesh(orbGeo,mat);mesh.castShadow=true;const core=new THREE.Mesh(coreGeo,new THREE.MeshBasicMaterial({color:secondary,transparent:true,opacity:.17}));mesh.add(core);const label=makeLabel(THREE,human?"@you":`@${usernames[(i-1)%usernames.length]}`,color);label.position.set(0,1.2,0);mesh.add(label);scene.add(mesh);orbs.push({id:`orb-${i}`,username:human?"@you":`@${usernames[(i-1)%usernames.length]}`,color,body,mesh,core,label,alive:true,isHuman:human,integrity:100,jumpReadyAt:0,airborne:false,personality:(["hunter","survivor","racer","opportunist"] as Personality[])[i%4]!,botHeading:rand()*Math.PI*2,botThinkAt:0,powerKind:null,powerExpiresAt:0,kineticUntil:0,shieldUntil:0,slamArmed:false,slamStartedAt:0})}
      const human=orbs[0]!;const shocks:Shockwave[]=[];const pairHits=new Map<string,number>();let cameraShake=0,lastFacing=new THREE.Vector3(0,0,-1),matchStart=0,live=false,resolved=false,lastUi=0,acc=0,prev=performance.now(),simTime=0;
      const burst=(x:number,y:number,z:number,power:number,color:string)=>{const g=new THREE.SphereGeometry(.5,20,12),m=new THREE.MeshBasicMaterial({color,transparent:true,opacity:.48,wireframe:true}),mesh=new THREE.Mesh(g,m);mesh.position.set(x,y,z);scene.add(mesh);shocks.push({mesh,born:performance.now(),life:260+power*180});cameraShake=Math.max(cameraShake,.04+power*.12)};
      const eliminate=(o:OrbSim,reason="SHATTERED")=>{if(!o.alive)return;o.alive=false;o.body.setEnabled(false);o.mesh.visible=false;const alive=orbs.filter(v=>v.alive);setSurvivors(alive.length);if(o.isHuman){setPhase("eliminated");setEventText("YOU'RE OUT · SPECTATING");audio.eliminated()}else setEventText(`${o.username} ${reason}`);if(alive.length<=1&&!resolved){resolved=true;const w=alive[0];setWinner(w?.username??null);if(w?.isHuman){setPhase("won");audio.victory()}else setPhase("finished");setEventText(w?`${w.username} WINS`:"MATCH COMPLETE")}};
      const grounded=(o:OrbSim)=>{const v=o.body.linvel();return Math.abs(v.y)<.72};
      const clearPower=(o:OrbSim)=>{o.powerKind=null;o.powerExpiresAt=0};
      const grantPower=(o:OrbSim,kind:ArenaPowerKind,now:number)=>{o.powerKind=kind;o.powerExpiresAt=now+config.weaponLifetimeMs;if(o.isHuman){setPower(kind);setPowerLeft(1);setEventText(`${POWER_META[kind].label} LOADED · SPACE TO USE`)}audio.powerPickup(kind)};
      const normalJump=(o:OrbSim,mult=1)=>{const now=performance.now();if(now<o.jumpReadyAt||!grounded(o))return false;const v=o.body.linvel();o.body.setLinvel({x:v.x,y:config.jumpImpulse*mult,z:v.z},true);o.jumpReadyAt=now+config.jumpCooldownMs;o.airborne=true;if(o.isHuman)audio.jump();return true};
      const useAction=(o:OrbSim)=>{if(!live||!o.alive)return;const now=performance.now();if(o.powerKind&&now>=o.powerExpiresAt)clearPower(o);const kind=o.powerKind;if(!kind){normalJump(o);return}
        if(kind==="kinetic"){const v=o.body.linvel(),speed=Math.hypot(v.x,v.z),dx=speed>.3?v.x/speed:(o.isHuman?lastFacing.x:Math.cos(o.botHeading)),dz=speed>.3?v.z/speed:(o.isHuman?lastFacing.z:Math.sin(o.botHeading));o.body.applyImpulse({x:dx*3.1,y:.18,z:dz*3.1},true);o.kineticUntil=now+1250;audio.powerUse(kind);clearPower(o)}
        else if(kind==="shield"){o.shieldUntil=now+2800;audio.powerUse(kind);clearPower(o)}
        else if(kind==="superjump"){if(normalJump(o,1.72)){audio.powerUse(kind);clearPower(o)}}
        else if(kind==="slam"){if(normalJump(o,1.48)){o.slamArmed=true;o.slamStartedAt=now;audio.powerUse(kind);clearPower(o)}}
        if(o.isHuman){setPower(o.powerKind);setPowerLeft(0)}
      };actionRef.current=()=>useAction(human);
      const start=()=>{if(live)return;setPhase("countdown");audio.startMusic();let n=3;setCountdown(n);const timer=window.setInterval(()=>{n-=1;setCountdown(n);if(n<=0){window.clearInterval(timer);setCountdown(0);setPhase("playing");setEventText("FIGHT FOR THE POWER RINGS");matchStart=performance.now();live=true}},650)};startRef.current=start;

      function radialSlam(o:OrbSim){const p=o.body.translation();burst(p.x,p.y,p.z,1,POWER_META.slam.color);audio.bump(1);for(const t of orbs){if(!t.alive||t===o)continue;const tp=t.body.translation(),dx=tp.x-p.x,dz=tp.z-p.z,dist=Math.hypot(dx,dz);if(dist>4.1*s||dist<.01)continue;const strength=(1-dist/(4.1*s));const damage=10+14*strength;t.integrity=Math.max(0,t.integrity-damage);t.body.applyImpulse({x:dx/dist*(1.5+2*strength),y:.55+strength*.6,z:dz/dist*(1.5+2*strength)},true);if(t.integrity<=0)eliminate(t)}if(o.isHuman)setEventText("GROUND SLAM · SHOCKWAVE")}
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
              const kinetic=now<attacker.kineticUntil;
              const shielded=now<target.shieldUntil;
              const power=clamp((closing-1.1)/4.2,0,1);
              let damage=clamp((closing-1.2)*config.impactDamageScale,0,4.2);
              if(kinetic)damage=clamp(17+power*16,16,33);
              if(shielded)damage*=.3;
              target.integrity=Math.max(0,target.integrity-damage);
              const direction=target===b?1:-1;
              const knock=(.34+power*.72)*(kinetic?2.5:1)*(shielded ? .45 : 1);
              target.body.applyImpulse({x:ux*direction*knock,y:.06+power*.2,z:uz*direction*knock},true);
              if(shielded)attacker.body.applyImpulse({x:-ux*direction*1.1,y:.14,z:-uz*direction*1.1},true);
              burst((pa.x+pb.x)/2,(pa.y+pb.y)/2,(pa.z+pb.z)/2,kinetic?1:power,target.color);
              audio.bump(kinetic?1:.28+power*.5);
              if(kinetic)setEventText(`${attacker.username} KINETIC HIT · ${Math.round(damage)} DAMAGE`);
              if(a.isHuman||b.isHuman)setIntegrity(Math.round(human.integrity));
              if(target.integrity<=0)eliminate(target);
            }
          }
        }
      }
      function updatePickups(now:number,matchElapsed:number){const respawnFactor=matchElapsed>=config.overchargeAt ? 0.38 : matchElapsed>=config.suddenDeathAt ? 0.58 : 1;for(const pickup of pickups){pickup.mesh.rotation.y+=.018;pickup.mesh.position.y=pickup.baseY+Math.sin(now*.003+pickup.x)*.15;const ready=now>=pickup.readyAt;pickup.mesh.visible=ready;if(!ready)continue;for(const o of orbs){if(!o.alive)continue;const p=o.body.translation();if(Math.hypot(p.x-pickup.x,p.z-pickup.z)>1.5*s||Math.abs(p.y-pickup.y)>2.4)continue;pickup.readyAt=now+config.ringRespawnMs*respawnFactor;pickup.mesh.visible=false;if(pickup.kind==="recovery"){const before=o.integrity;o.integrity=Math.min(100,o.integrity+config.recoveryAmount);audio.recover();if(o.isHuman){setIntegrity(Math.round(o.integrity));setEventText(`RECOVERY +${Math.round(o.integrity-before)} INTEGRITY`)}}else grantPower(o,pickup.kind,now);break}}
        for(const ped of pedestals){ped.glow.rotation.z+=.025;const ready=now>=ped.readyAt;ped.glow.visible=ready;if(!ready)continue;for(const o of orbs){if(!o.alive||o.powerKind)continue;const p=o.body.translation();if(Math.hypot(p.x-ped.x,p.z-ped.z)>1.55*s||p.y<1.35)continue;const kinds:ArenaPowerKind[]=["kinetic","slam","shield","superjump"];const kind=kinds[Math.floor(rand()*kinds.length)]!;ped.readyAt=now+config.pedestalRespawnMs*respawnFactor;ped.glow.visible=false;grantPower(o,kind,now);break}}
      }
      function botInput(o:OrbSim,nowSec:number,nowMs:number){const p=o.body.translation();if(o.powerKind&&nowMs<o.powerExpiresAt){let nearest=99;for(const e of orbs){if(e===o||!e.alive)continue;const ep=e.body.translation();nearest=Math.min(nearest,Math.hypot(ep.x-p.x,ep.z-p.z))}if(nearest<4.5&&rand()<.08)useAction(o)}if(nowSec>=o.botThinkAt){let tx=0,tz=0,best=Infinity;const candidates:{x:number;z:number;score:number}[]=[];for(const pick of pickups){if(nowMs<pick.readyAt)continue;if(pick.kind==="recovery"&&o.integrity>62)continue;const dd=Math.hypot(pick.x-p.x,pick.z-p.z);candidates.push({x:pick.x,z:pick.z,score:dd*(pick.kind==="recovery" ? .62 : 1)})}for(const ped of pedestals){if(nowMs<ped.readyAt)continue;const dd=Math.hypot(ped.x-p.x,ped.z-p.z);candidates.push({x:ped.x,z:ped.z,score:dd*.9})}for(const c of candidates)if(c.score<best){best=c.score;tx=c.x;tz=c.z}if(!candidates.length||o.powerKind){const enemies=orbs.filter(v=>v.alive&&v!==o);let target=enemies[0];best=Infinity;for(const e of enemies){const ep=e.body.translation(),dd=Math.hypot(ep.x-p.x,ep.z-p.z);if(dd<best){best=dd;target=e}}if(target){const tp=target.body.translation();tx=tp.x;tz=tp.z}}o.botHeading=Math.atan2(tz-p.z,tx-p.x)+(rand()-.5)*(o.personality==="hunter" ? .18 : .45);o.botThinkAt=nowSec+.18+rand()*.32;if(rand()<.055)normalJump(o)}return{x:Math.cos(o.botHeading),y:-Math.sin(o.botHeading)}}
      const resize=()=>{const r=mount.getBoundingClientRect();renderer.setSize(Math.max(1,r.width),Math.max(1,r.height),false);camera.aspect=r.width/Math.max(1,r.height);camera.updateProjectionMatrix()};const ro=new ResizeObserver(resize);ro.observe(mount);resize();
      const look=new THREE.Vector3(),desired=new THREE.Vector3();
      const render=(ms:number)=>{if(cancelled)return;frame=requestAnimationFrame(render);const dt=Math.min(.05,(ms-prev)/1000);prev=ms;const matchElapsed=live?(ms-matchStart)/1000:0;if(live&&!resolved){setElapsed(matchElapsed);const alive=orbs.filter(o=>o.alive).length;audio.setIntensity(clamp(Math.max(matchElapsed/config.maxSeconds,1-alive/playerCount),0,1));if(matchElapsed>config.overchargeAt)setEventText("OVERCHARGE · POWER RINGS RECHARGE FAST");else if(matchElapsed>config.suddenDeathAt)setEventText("SUDDEN DEATH · HUNT THE POWERS");acc+=dt;while(acc>=PHYSICS.fixedStep){simTime+=PHYSICS.fixedStep;for(const o of orbs){if(!o.alive)continue;let ix=0,iy=0;if(o.isHuman){const k=controlsRef.current;let sx=(k.right?1:0)-(k.left?1:0),sy=(k.up?1:0)-(k.down?1:0);if(controlModeRef.current==="touch"){sx=k.touchX;sy=k.touchY}else if(controlModeRef.current==="sensor"&&sensorRef.current.active){sx=clamp((sensorRef.current.gamma-sensorRef.current.neutralGamma)/PHYSICS.sensorFullScaleDeg,-1,1);sy=clamp(-(sensorRef.current.beta-sensorRef.current.neutralBeta)/PHYSICS.sensorFullScaleDeg,-1,1)}const rightX=-lastFacing.z,rightZ=lastFacing.x,worldX=rightX*sx+lastFacing.x*sy,worldZ=rightZ*sx+lastFacing.z*sy;ix=worldX;iy=-worldZ;if(Math.hypot(worldX,worldZ)>.2){const desiredHeading=new THREE.Vector3(worldX,0,worldZ).normalize();lastFacing.lerp(desiredHeading,.026).normalize()}}else{const b=botInput(o,simTime,performance.now());ix=b.x;iy=b.y}const v=o.body.linvel(),steer=nextPlanarVelocity({x:v.x,z:v.z},ix,iy,o.isHuman&&controlModeRef.current==="keys"?"desktop":"mobile");o.body.setLinvel({x:steer.x,y:v.y,z:steer.z},true)}world.step();const now=performance.now();handleImpacts(now);updatePickups(now,matchElapsed);for(const o of orbs){if(!o.alive)continue;const v=o.body.linvel(),cl=clampPlanarSpeed({x:v.x,z:v.z},o.isHuman&&controlModeRef.current==="keys"?"desktop":"mobile");if(cl.x!==v.x||cl.z!==v.z)o.body.setLinvel({x:cl.x,y:v.y,z:cl.z},true);const p=o.body.translation();if(o.slamArmed&&now-o.slamStartedAt>260&&grounded(o)){o.slamArmed=false;radialSlam(o)}if(o.airborne&&Math.abs(v.y)<.55)o.airborne=false;if(o.powerKind&&now>=o.powerExpiresAt){clearPower(o);if(o.isHuman){setPower(null);setPowerLeft(0);setEventText("POWER EXPIRED · FIND ANOTHER")}}if(p.y<-5){o.body.setTranslation({x:clamp(p.x,-arenaHalf*.7,arenaHalf*.7),y:2,z:clamp(p.z,-arenaHalf*.7,arenaHalf*.7)},true);o.body.setLinvel({x:0,y:0,z:0},true);o.integrity=Math.max(1,o.integrity-4)}}acc-=PHYSICS.fixedStep}if(matchElapsed>=config.maxSeconds&&!resolved){const aliveOrbs=orbs.filter(o=>o.alive).sort((a,b)=>b.integrity-a.integrity);aliveOrbs.slice(1).forEach(o=>eliminate(o,"LOST SUDDEN DEATH"))}if(ms-lastUi>90){lastUi=ms;setSurvivors(orbs.filter(o=>o.alive).length);setIntegrity(Math.round(human.integrity));setJumpCooldown(clamp((human.jumpReadyAt-performance.now())/config.jumpCooldownMs,0,1));setPower(human.powerKind);setPowerLeft(human.powerKind?clamp((human.powerExpiresAt-performance.now())/config.weaponLifetimeMs,0,1):0)}}
        for(const o of orbs){if(!o.alive)continue;const p=o.body.translation(),q=o.body.rotation();o.mesh.position.set(p.x,p.y,p.z);o.mesh.quaternion.set(q.x,q.y,q.z,q.w);o.label.quaternion.copy(camera.quaternion);const damage=1-o.integrity/100,mat=o.mesh.material as import("three").MeshPhysicalMaterial;mat.emissiveIntensity=1.05+damage*1.5+(o.powerKind ? .7 : 0)+(performance.now()<o.shieldUntil ? .9 : 0);o.core.scale.setScalar(1+damage*.18+(o.powerKind ? .08 : 0))}
        logo.rotation.y+=dt*.16;
        for(let i=shocks.length-1;i>=0;i--){const sh=shocks[i]!,age=ms-sh.born,t=age/sh.life;if(t>=1){scene.remove(sh.mesh);(sh.mesh.geometry as import("three").BufferGeometry).dispose();(sh.mesh.material as import("three").Material).dispose();shocks.splice(i,1)}else{sh.mesh.scale.setScalar(1+t*3.6);(sh.mesh.material as import("three").MeshBasicMaterial).opacity=.44*(1-t)}}
        const focus=human.alive?human:orbs.find(o=>o.alive);if(focus){const p=focus.body.translation(),v=focus.body.linvel(),speed=Math.hypot(v.x,v.z),back=mobileish?10.8:10,height=mobileish?6.2:5.7;desired.set(p.x-lastFacing.x*back,p.y+height,p.z-lastFacing.z*back);if(cameraShake>.002){desired.x+=(rand()-.5)*cameraShake;desired.y+=(rand()-.5)*cameraShake;desired.z+=(rand()-.5)*cameraShake;cameraShake*=.86}camera.position.lerp(desired,1-Math.exp(-dt*6.5));look.set(p.x+lastFacing.x*(2.5+speed*.16),p.y+.55,p.z+lastFacing.z*(2.5+speed*.16));camera.lookAt(look)}renderer.render(scene,camera)};render(performance.now());
      cleanupThree=()=>{cancelAnimationFrame(frame);ro.disconnect();audio.stop();orbGeo.dispose();coreGeo.dispose();terrainMat.dispose();renderer.dispose();mount.innerHTML=""};
    })();
    return()=>{cancelled=true;cleanupThree?.();audio.stop();window.removeEventListener("deviceorientation",orientation);window.removeEventListener("keydown",kd);window.removeEventListener("keyup",ku)};
  },[config,generation,playerCount,seed,style]);

  const touchStart=useCallback((e:React.PointerEvent<HTMLDivElement>)=>e.currentTarget.setPointerCapture(e.pointerId),[]);const touchMove=useCallback((e:React.PointerEvent<HTMLDivElement>)=>{if(!e.currentTarget.hasPointerCapture(e.pointerId))return;const r=e.currentTarget.getBoundingClientRect(),x=(e.clientX-(r.left+r.width/2))/(r.width*.36),y=(e.clientY-(r.top+r.height/2))/(r.height*.36),m=Math.max(1,Math.hypot(x,y));controlsRef.current.touchX=clamp(x/m,-1,1);controlsRef.current.touchY=clamp(-y/m,-1,1)},[]);const touchEnd=useCallback((e:React.PointerEvent<HTMLDivElement>)=>{controlsRef.current.touchX=0;controlsRef.current.touchY=0;try{e.currentTarget.releasePointerCapture(e.pointerId)}catch{}},[]);
  const left=Math.max(0,config.maxSeconds-elapsed),powerMeta=power?POWER_META[power]:null;
  return <div className="arena-sandbox-game arena-course-game">
    <div ref={mountRef} className="arena-sandbox-canvas"/>
    <div className="arena-hud arena-hud-top">
      <div><span>ORBS REMAIN</span><strong>{survivors}</strong></div>
      <div className="arena-event"><strong>{eventText}</strong><small>{Math.floor(left/60)}:{String(Math.floor(left%60)).padStart(2,"0")}</small></div>
      <div className="arena-vitals"><span>INTEGRITY {integrity}%</span><div className="arena-meter"><i style={{transform:`scaleX(${integrity/100})`}}/></div>{powerMeta?<><span style={{color:powerMeta.color}}>{powerMeta.label}</span><div className="arena-meter arena-power-meter"><i style={{transform:`scaleX(${powerLeft})`,background:powerMeta.color}}/></div></>:null}</div>
    </div>
    {phase==="ready"?<div className="arena-center-card"><span>ADMIN ARENA V4</span><h3>POWER COLOSSEUM</h3><p>Fight for temporary weapons, jump onto power pedestals, use the multi-level Orb dais, and grab pink recovery rings for a second chance. Cyan = blast · purple = slam · green = shield · gold = super jump.</p><button className="btn-primary" onClick={()=>startRef.current()}>Enter Arena →</button></div>:null}
    {phase==="countdown"?<div className="arena-countdown">{countdown||"GO"}</div>:null}
    {(phase==="eliminated"||phase==="finished"||phase==="won")?<div className="arena-result-card"><span>{phase==="eliminated"?"SPECTATING":"MATCH COMPLETE"}</span><h3>{phase==="won"?"YOU WIN":winner?`${winner} WINS`:"YOU'RE OUT"}</h3><p>{phase==="eliminated"?`${survivors} Orbs remain. Watch them fight for the remaining powers.`:"Last Orb standing takes the prize."}</p></div>:null}
    {phase==="playing"?<div className="arena-jump-wrap"><button className={`arena-jump ${power?"armed":""}`} style={powerMeta?{borderColor:powerMeta.color,boxShadow:`0 0 28px ${powerMeta.color}55`}:undefined} onClick={()=>actionRef.current()} disabled={!power&&jumpCooldown>0.02}><span>{powerMeta?powerMeta.label.split(" ")[0]:"JUMP"}</span><i style={{transform:`scaleX(${power?powerLeft:1-jumpCooldown})`,background:powerMeta?.color}}/></button></div>:null}
    {phase==="playing"&&controlMode==="touch"?<div className="game-touch-pad arena-touch" onPointerDown={touchStart} onPointerMove={touchMove} onPointerUp={touchEnd} onPointerCancel={touchEnd}><div className="game-touch-knob"/></div>:null}
    {sensorAvailable&&phase==="playing"?<div className="arena-controls"><button onClick={()=>void requestMotion()}>{controlMode==="sensor"?"Tilt active":"Enable tilt"}</button>{controlMode==="sensor"?<button onClick={()=>{controlModeRef.current="touch";setControlMode("touch")}}>Touch control</button>:null}</div>:null}
    <div className="arena-control-hint"><span className="arena-desktop-hint">ARROWS / WASD · ROLL &nbsp;&nbsp; SPACE · {powerMeta?"USE POWER":"JUMP"}</span><span className="arena-mobile-hint">ROLL · {powerMeta?"USE POWER":"JUMP"} · FIGHT FOR RINGS · PINK = RECOVERY</span></div>
  </div>;
}
