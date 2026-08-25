"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PHYSICS } from "@/game/constants";
import { nextPlanarVelocity } from "@/game/simulation";
import {
  RACE_RESCUE_MS,
  buildRaceConfig,
  circularPointDistance,
  generateRaceManifest,
  isForwardLapWrap,
  nearestRacePoint,
  safeRaceRecoveryPoint,
  safeRaceGatePoint,
  raceProgress,
  type RaceItemKind,
} from "@/game/race";
import { RaceAudioEngine } from "@/game/raceAudio";
import type { GameStyle } from "@/game/types";

type Props = { playerCount:number; style:GameStyle; seed:string; generation:number };
type Phase = "ready"|"countdown"|"playing"|"won"|"finished";
type ControlMode = "keys"|"touch";
type Racer = {
  id:string; username:string; color:string; body:import("@dimforge/rapier3d-compat").RigidBody;
  mesh:import("three").Mesh; core:import("three").Mesh; label:import("three").Sprite;
  visualPos:import("three").Vector3; visualQuat:import("three").Quaternion;
  isHuman:boolean; pointIndex:number; previousPointIndex:number; lap:number; lapArmed:boolean; finishedAt:number|null;
  jumpReadyAt:number; boostUntil:number; slowedUntil:number; item:RaceItemKind|null; pickupReady:Map<string,number>;
  recovering:boolean; rescueStartedAt:number; rescueUntil:number; rescueFrom:import("three").Vector3; rescuePointIndex:number; rescueGraceUntil:number; cloud:import("three").Group;
  botLane:number; botLaneTarget:number; botThinkAt:number; lastHitAt:number; plungeAirUntil:number; plungeLaunchLockUntil:number;
};
type Missile = { mesh:import("three").Group; owner:Racer; born:number; life:number; position:import("three").Vector3; progress:number; lane:number; speed:number };
type Bomb = { mesh:import("three").Group; owner:Racer; born:number; armedAt:number; expiresAt:number; position:import("three").Vector3; hit:Set<string> };

const clamp=(v:number,min:number,max:number)=>Math.max(min,Math.min(max,v));
const names=["orbitaljup","bonkpilot","solsurfer","caturday","mooncrate","zerogravity","mintghost","blockrunner","jupcat","voidwalker","tokenpunk","solanaut","orbmaxi","driftmode","neonape","cryptokite","glasscanon","rollhard","chainchaser","memeengine","jupiterian","vaultfox","orbitron","turbocat","candycloud","solstice","nightmarket","ghostroute","mintcondition","prismcat","warpdrive","moonrail","starfruit","lamportlane","glowworm","supernova","bagrocket","speedfiend","violetcat","solarflare","helioroll","meteormax","orbitkid","stardegen","jupstream","nebular","trackcat","pixelpilot","voidlane"];

function seeded(seed:string){let h=2166136261;for(let i=0;i<seed.length;i++)h=Math.imul(h^seed.charCodeAt(i),16777619);return()=>{h+=h<<13;h^=h>>>7;h+=h<<3;h^=h>>>17;h+=h<<5;return(h>>>0)/4294967296}}
function orbColor(i:number,r:()=>number){const hue=(i*137.508+r()*24)%360;return `hsl(${hue.toFixed(0)} 92% 62%)`}
function fmt(seconds:number){const m=Math.floor(seconds/60),s=Math.floor(seconds%60),ms=Math.floor((seconds%1)*100);return `${m}:${String(s).padStart(2,"0")}.${String(ms).padStart(2,"0")}`}

function makePfp(THREE:typeof import("three"),initial:string,tint:string){
  const c=document.createElement("canvas");c.width=128;c.height=128;const x=c.getContext("2d")!;
  x.clearRect(0,0,128,128);x.fillStyle=tint;x.beginPath();x.arc(64,64,61,0,Math.PI*2);x.fill();
  x.fillStyle="#07101f";x.beginPath();x.arc(64,64,51,0,Math.PI*2);x.fill();
  x.fillStyle="#fff";x.font="900 48px Arial";x.textAlign="center";x.textBaseline="middle";x.fillText(initial.slice(0,1).toUpperCase(),64,67);
  const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;
  const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:t,transparent:true,depthWrite:false,depthTest:false}));
  sprite.scale.set(.34,.34,1);sprite.renderOrder=20;return sprite;
}

function makeCheckeredGate(THREE:typeof import("three"),width:number,label:string,accent:string,compact=false){
  const group=new THREE.Group();const poleHeight=compact?3.7:4.9;const poleRadius=compact ? .10 : .14;
  const poleMat=new THREE.MeshPhysicalMaterial({color:"#E9F8FF",emissive:accent,emissiveIntensity:.28,metalness:.55,roughness:.24});
  for(const side of [-1,1]){const pole=new THREE.Mesh(new THREE.CylinderGeometry(poleRadius,poleRadius,poleHeight,12),poleMat);pole.position.set(width*.47*side,poleHeight*.5,0);group.add(pole)}
  const c=document.createElement("canvas");c.width=1024;c.height=compact?192:256;const x=c.getContext("2d")!;const cell=64;
  for(let row=0;row<Math.ceil(c.height/cell);row++)for(let col=0;col<Math.ceil(c.width/cell);col++){x.fillStyle=(row+col)%2===0?"#F7FAFF":"#09101E";x.fillRect(col*cell,row*cell,cell,cell)}
  x.fillStyle="rgba(4,8,18,.82)";x.fillRect(0,c.height*.31,c.width,c.height*.38);x.fillStyle="#FFFFFF";x.font=`900 ${compact?58:72}px Arial`;x.textAlign="center";x.textBaseline="middle";x.fillText(label,c.width/2,c.height/2+2);
  const tex=new THREE.CanvasTexture(c);tex.colorSpace=THREE.SRGBColorSpace;const bannerMat=new THREE.MeshBasicMaterial({map:tex,side:THREE.FrontSide,transparent:true});
  const bannerGeo=new THREE.PlaneGeometry(width*.94,compact?1.15:1.55);
  const bannerFront=new THREE.Mesh(bannerGeo,bannerMat);bannerFront.position.set(0,poleHeight-(compact ? .55 : .72),.018);group.add(bannerFront);
  const bannerBack=new THREE.Mesh(bannerGeo,bannerMat.clone());bannerBack.position.set(0,poleHeight-(compact ? .55 : .72),-.018);bannerBack.rotation.y=Math.PI;group.add(bannerBack);
  const beam=new THREE.Mesh(new THREE.BoxGeometry(width*.96,.11,.12),poleMat);beam.position.y=poleHeight;group.add(beam);return group;
}

function makeOrbMaterial(THREE:typeof import("three"),primary:string,secondary:string,accent:string){
  return new THREE.ShaderMaterial({
    transparent:true,depthWrite:true,
    uniforms:{uTime:{value:0},uPrimary:{value:new THREE.Color(primary)},uSecondary:{value:new THREE.Color(secondary)},uAccent:{value:new THREE.Color(accent)},uSpeed:{value:0}},
    vertexShader:`varying vec3 vObj;varying vec3 vNormalW;varying vec3 vWorld;void main(){vObj=position;vNormalW=normalize(mat3(modelMatrix)*normal);vec4 world=modelMatrix*vec4(position,1.0);vWorld=world.xyz;gl_Position=projectionMatrix*viewMatrix*world;}`,
    fragmentShader:`precision highp float;varying vec3 vObj;varying vec3 vNormalW;varying vec3 vWorld;uniform float uTime;uniform float uSpeed;uniform vec3 uPrimary;uniform vec3 uSecondary;uniform vec3 uAccent;void main(){vec3 N=normalize(vNormalW);vec3 V=normalize(cameraPosition-vWorld);float fres=pow(1.0-max(dot(N,V),0.0),2.2);float ribbons=sin(vObj.x*12.0+vObj.y*8.0+uTime*.0018)+sin(vObj.z*15.0-vObj.y*9.0-uTime*.0013);float veins=smoothstep(.42,.9,abs(ribbons*.5));vec3 base=mix(uPrimary,uSecondary,.36+.28*sin(vObj.y*8.0+uTime*.001));base=mix(base,uAccent,veins*.28);base+=fres*(uSecondary*.78+vec3(.24));base+=uAccent*clamp(uSpeed/22.0,0.0,1.0)*.34;float alpha=.88+fres*.1;gl_FragColor=vec4(base,alpha);}`
  });
}

function makeTrackMaterial(THREE:typeof import("three"),style:GameStyle){
  return new THREE.ShaderMaterial({
    side:THREE.DoubleSide,depthWrite:true,
    uniforms:{uTime:{value:0},uA:{value:new THREE.Color(style.marble)},uB:{value:new THREE.Color(style.marbleSecondary)},uC:{value:new THREE.Color(style.accent)},uFloor:{value:new THREE.Color(style.floor)}},
    vertexShader:`varying vec2 vUv;varying vec3 vWorld;void main(){vUv=uv;vec4 w=modelMatrix*vec4(position,1.0);vWorld=w.xyz;gl_Position=projectionMatrix*viewMatrix*w;}`,
    fragmentShader:`precision highp float;varying vec2 vUv;varying vec3 vWorld;uniform float uTime;uniform vec3 uA;uniform vec3 uB;uniform vec3 uC;uniform vec3 uFloor;float s(float x){return sin(x)*.5+.5;}void main(){float t=uTime*.00022;vec2 p=vec2((vUv.x-.5)*7.0,vUv.y*.85);float w1=sin(p.y*1.36+sin(p.x*2.8+t*2.1)*1.35+t*2.4);float w2=sin(p.y*.77-p.x*2.25+sin(p.y*.19-t)*2.0-t*1.55);float w3=sin(length(vec2(p.x*.86,mod(p.y,15.0)-7.5))*1.55-t*2.2);float oil=s(w1*1.15+w2*.92+w3*.62);float topology=s(sin(p.x*5.8+w2*1.7+t*.8)+sin(p.y*.42+w1*1.4));vec3 c=mix(uFloor*.38,uA,oil);c=mix(c,uB,s(w2+w3)*.56);c=mix(c,uC,topology*.42);float filament=smoothstep(.91,.99,sin((oil+topology)*15.0+p.y*.17)*.5+.5);c+=vec3(.36,.55,.8)*filament*.42;float edge=smoothstep(.39,.49,abs(vUv.x-.5));c+=mix(uB,uC,oil)*edge*.18;gl_FragColor=vec4(c,1.0);}`
  });
}

function makeSky(THREE:typeof import("three"),accent:string){
  const g=new THREE.SphereGeometry(330,44,28),m=new THREE.ShaderMaterial({side:THREE.BackSide,depthWrite:false,uniforms:{uAccent:{value:new THREE.Color(accent)}},vertexShader:`varying vec3 vDir;void main(){vDir=normalize(position);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,fragmentShader:`varying vec3 vDir;uniform vec3 uAccent;void main(){float h=pow(1.0-abs(vDir.y),5.0);float a=sin(vDir.x*9.0+vDir.z*12.0+vDir.y*5.0)*.5+.5;float aur=smoothstep(.72,1.0,a)*h;vec3 c=mix(vec3(.004,.006,.027),vec3(.018,.028,.095),h);c+=uAccent*h*.22;c+=vec3(.05,.75,.95)*aur*.2;gl_FragColor=vec4(c,1.0);}`});return new THREE.Mesh(g,m);
}

function makeCloud(THREE:typeof import("three"),color:string){
  const g=new THREE.Group();const mat=new THREE.MeshBasicMaterial({color,transparent:true,opacity:.8,blending:THREE.AdditiveBlending,depthWrite:false});
  [[0,0,0,.65],[-.55,.02,.08,.44],[.52,.04,.08,.48],[-.2,.16,-.28,.5],[.26,.18,-.25,.53]].forEach(([x,y,z,s])=>{const m=new THREE.Mesh(new THREE.SphereGeometry(.62,12,8),mat);m.position.set(x!,y!,z!);m.scale.setScalar(s!);g.add(m)});g.visible=false;return g;
}

function pointPosition(THREE:typeof import("three"),p:{x:number;y:number;z:number;rightX:number;rightY:number;rightZ:number;width:number},lane=0,y=0){return new THREE.Vector3(p.x+p.rightX*p.width*lane,p.y+p.rightY*p.width*lane+y,p.z+p.rightZ*p.width*lane)}

export default function RaceSandbox({playerCount,style,seed,generation}:Props){
  const mountRef=useRef<HTMLDivElement|null>(null);
  const controlsRef=useRef({left:false,right:false,up:false,down:false,touchX:0});
  const actionRef=useRef<()=>void>(()=>undefined),startRef=useRef<()=>void>(()=>undefined);
  const [phase,setPhase]=useState<Phase>("ready"),[countdown,setCountdown]=useState(0),[elapsed,setElapsed]=useState(0),[lap,setLap]=useState(1),[place,setPlace]=useState(playerCount),[speed,setSpeed]=useState(0),[item,setItem]=useState<RaceItemKind|null>(null),[eventText,setEventText]=useState("RACE"),[controlMode,setControlMode]=useState<ControlMode>("keys"),[rescueLeft,setRescueLeft]=useState(0),[wake,setWake]=useState(false),[winner,setWinner]=useState<string|null>(null);
  const config=useMemo(()=>buildRaceConfig(playerCount),[playerCount]);
  const manifest=useMemo(()=>generateRaceManifest(seed,style,config.trackWidth),[seed,style,config.trackWidth]);

  useEffect(()=>{
    const mount=mountRef.current;if(!mount)return;let cancelled=false,frame=0,cleanupThree:(()=>void)|null=null;const audio=new RaceAudioEngine();
    setPhase("ready");setElapsed(0);setLap(1);setPlace(playerCount);setSpeed(0);setItem(null);setEventText("RACE");setRescueLeft(0);setWake(false);setWinner(null);
    const coarse=window.matchMedia("(pointer: coarse)").matches;if(coarse)setControlMode("touch");
    const onKey=(e:KeyboardEvent,down:boolean)=>{if(["ArrowUp","ArrowDown","ArrowLeft","ArrowRight","KeyW","KeyA","KeyS","KeyD","Space"].includes(e.code))e.preventDefault();if(e.code==="ArrowLeft"||e.code==="KeyA")controlsRef.current.left=down;if(e.code==="ArrowRight"||e.code==="KeyD")controlsRef.current.right=down;if(e.code==="ArrowUp"||e.code==="KeyW")controlsRef.current.up=down;if(e.code==="ArrowDown"||e.code==="KeyS")controlsRef.current.down=down;if(e.code==="Space"&&down&&!e.repeat)actionRef.current()};
    const kd=(e:KeyboardEvent)=>onKey(e,true),ku=(e:KeyboardEvent)=>onKey(e,false);window.addEventListener("keydown",kd,{passive:false});window.addEventListener("keyup",ku,{passive:false});

    (async()=>{
      const [THREE,RAPIER]=await Promise.all([import("three"),import("@dimforge/rapier3d-compat")]);await RAPIER.init();if(cancelled||!mountRef.current)return;
      const mobileish=coarse||window.innerWidth<800;const scene=new THREE.Scene();scene.fog=new THREE.FogExp2("#030513",.0024);const camera=new THREE.PerspectiveCamera(mobileish?66:60,1,.08,620);
      const renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:"high-performance"});renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.12;let renderDpr=Math.min(devicePixelRatio||1,mobileish?1.08:1.42);const maxDpr=renderDpr;renderer.setPixelRatio(renderDpr);renderer.shadowMap.enabled=false;mount.innerHTML="";mount.appendChild(renderer.domElement);
      scene.add(makeSky(THREE,style.accent));scene.add(new THREE.HemisphereLight("#B8D8FF","#071126",1.65));const sun=new THREE.DirectionalLight("#FFFFFF",1.8);sun.position.set(40,90,30);scene.add(sun);

      const starsGeo=new THREE.BufferGeometry(),stars:number[]=[];const rand=seeded(`${seed}:stars`);for(let i=0;i<1250;i++){const r=150+rand()*145,a=rand()*Math.PI*2,u=rand()*2-1,s=Math.sqrt(1-u*u);stars.push(Math.cos(a)*s*r,u*r,Math.sin(a)*s*r)}starsGeo.setAttribute("position",new THREE.Float32BufferAttribute(stars,3));const starsMat=new THREE.PointsMaterial({color:"#DDEBFF",size:.55,transparent:true,opacity:.72,depthWrite:false});scene.add(new THREE.Points(starsGeo,starsMat));
      const planetMat=new THREE.MeshPhysicalMaterial({color:style.marbleSecondary,emissive:style.accent,emissiveIntensity:.35,roughness:.5,metalness:.05});const planet=new THREE.Mesh(new THREE.SphereGeometry(18,32,20),planetMat);planet.position.set(-116,42,-104);scene.add(planet);const ring=new THREE.Mesh(new THREE.TorusGeometry(25,.9,12,64),new THREE.MeshBasicMaterial({color:style.accent,transparent:true,opacity:.35,depthWrite:false}));ring.position.copy(planet.position);ring.rotation.x=1.15;ring.rotation.z=.25;scene.add(ring);

      const verts:number[]=[],uvs:number[]=[],indices:number[]=[];for(const p of manifest.points){const half=p.width/2;verts.push(p.x-p.rightX*half,p.y-p.rightY*half,p.z-p.rightZ*half,p.x+p.rightX*half,p.y+p.rightY*half,p.z+p.rightZ*half);const v=p.distance/manifest.lapLength*18;uvs.push(0,v,1,v)}
      for(let i=0;i<manifest.points.length;i++){const j=(i+1)%manifest.points.length,p=manifest.points[i]!,n=manifest.points[j]!;if(p.gap||n.gap)continue;const a=i*2,b=i*2+1,c=j*2,d=j*2+1;indices.push(a,b,c,b,d,c)}
      const trackGeo=new THREE.BufferGeometry();trackGeo.setAttribute("position",new THREE.Float32BufferAttribute(verts,3));trackGeo.setAttribute("uv",new THREE.Float32BufferAttribute(uvs,2));trackGeo.setIndex(indices);trackGeo.computeVertexNormals();const trackMat=makeTrackMaterial(THREE,style);const track=new THREE.Mesh(trackGeo,trackMat);scene.add(track);
      const edgePositions:number[]=[];for(let i=0;i<manifest.points.length;i++){const j=(i+1)%manifest.points.length,p=manifest.points[i]!,n=manifest.points[j]!;if(p.gap||n.gap)continue;for(const side of [-1,1]){const hp=p.width/2*side,hn=n.width/2*side;edgePositions.push(p.x+p.rightX*hp,p.y+p.rightY*hp+.035,p.z+p.rightZ*hp,n.x+n.rightX*hn,n.y+n.rightY*hn+.035,n.z+n.rightZ*hn)}}const edgeGeo=new THREE.BufferGeometry();edgeGeo.setAttribute("position",new THREE.Float32BufferAttribute(edgePositions,3));const edgeMat=new THREE.LineBasicMaterial({color:style.marbleSecondary,transparent:true,opacity:.82,blending:THREE.AdditiveBlending});scene.add(new THREE.LineSegments(edgeGeo,edgeMat));

      const world=new RAPIER.World({x:0,y:-9.81,z:0});const collider=RAPIER.ColliderDesc.trimesh(new Float32Array(verts),new Uint32Array(indices)).setFriction(1.05).setRestitution(.04);world.createCollider(collider);

      const orientAt=(obj:import("three").Object3D,pointIndex:number)=>{const p=manifest.points[pointIndex]!;const tangent=new THREE.Vector3(p.tangentX,p.tangentY,p.tangentZ).normalize(),right=new THREE.Vector3(p.rightX,p.rightY,p.rightZ).normalize();right.addScaledVector(tangent,-right.dot(tangent)).normalize();const up=new THREE.Vector3().crossVectors(tangent,right).normalize();const m=new THREE.Matrix4().makeBasis(right,up,tangent);obj.quaternion.setFromRotationMatrix(m)};

      const boostMeshes:import("three").Mesh[]=[];for(const b of manifest.boosts){const p=manifest.points[b.pointIndex]!,m=new THREE.Mesh(new THREE.BoxGeometry(p.width*.31,.055,2.5),new THREE.MeshBasicMaterial({color:style.marbleSecondary,transparent:true,opacity:.78,blending:THREE.AdditiveBlending}));m.position.copy(pointPosition(THREE,p,b.lane,.07));orientAt(m,b.pointIndex);scene.add(m);boostMeshes.push(m)}
      const rampMeshes:import("three").Mesh[]=[];for(const r of manifest.ramps){const p=manifest.points[r.pointIndex]!,width=p.width*.40,length=5.15,height=.54,m=new THREE.Mesh(new THREE.BoxGeometry(width,height,length),new THREE.MeshPhysicalMaterial({color:style.accent,emissive:style.marbleSecondary,emissiveIntensity:1.0,roughness:.18,metalness:.25,clearcoat:1}));m.position.copy(pointPosition(THREE,p,r.lane,.27));orientAt(m,r.pointIndex);m.rotateX(-.17);scene.add(m);m.updateMatrixWorld(true);const wp=new THREE.Vector3(),wq=new THREE.Quaternion(),ws=new THREE.Vector3();m.matrixWorld.decompose(wp,wq,ws);world.createCollider(RAPIER.ColliderDesc.cuboid(width/2,height/2,length/2).setTranslation(wp.x,wp.y,wp.z).setRotation({x:wq.x,y:wq.y,z:wq.z,w:wq.w}).setFriction(1.08).setRestitution(.04));rampMeshes.push(m)}
      const launchP=manifest.points[manifest.plungeLaunchIndex]!,launchRampWidth=launchP.width*.92,launchRampLength=9.0,launchRampHeight=.48;const launchRamp=new THREE.Mesh(new THREE.BoxGeometry(launchRampWidth,launchRampHeight,launchRampLength),new THREE.MeshPhysicalMaterial({color:style.marbleSecondary,emissive:style.accent,emissiveIntensity:1.9,roughness:.08,metalness:.35,clearcoat:1}));launchRamp.position.copy(pointPosition(THREE,launchP,0,.24));orientAt(launchRamp,manifest.plungeLaunchIndex);launchRamp.rotateX(-.26);scene.add(launchRamp);launchRamp.updateMatrixWorld(true);{const wp=new THREE.Vector3(),wq=new THREE.Quaternion(),ws=new THREE.Vector3();launchRamp.matrixWorld.decompose(wp,wq,ws);world.createCollider(RAPIER.ColliderDesc.cuboid(launchRampWidth/2,launchRampHeight/2,launchRampLength/2).setTranslation(wp.x,wp.y,wp.z).setRotation({x:wq.x,y:wq.y,z:wq.z,w:wq.w}).setFriction(1.12).setRestitution(.03))}
      const pickupVisuals=new Map<string,{group:import("three").Group;hiddenUntil:number;phase:number}>();
      const pickupCooldowns=new Map<string,number>();
      for(const [pickIndex,pick] of manifest.pickups.entries()){
        const p=manifest.points[pick.pointIndex]!,g=new THREE.Group(),color=pick.kind==="missile"?"#FF9A3C":pick.kind==="bomb"?"#FF4D72":"#5EFFF2";
        const halo=new THREE.Mesh(new THREE.TorusGeometry(.78,.095,10,40),new THREE.MeshBasicMaterial({color,transparent:true,opacity:.95,blending:THREE.AdditiveBlending,depthWrite:false}));
        halo.rotation.y=Math.PI/2;g.add(halo);
        const inner=new THREE.Mesh(new THREE.OctahedronGeometry(.28,0),new THREE.MeshBasicMaterial({color:"#FFFFFF",transparent:true,opacity:.95,blending:THREE.AdditiveBlending,depthWrite:false}));
        inner.rotation.z=Math.PI/4;g.add(inner);
        const ring2=new THREE.Mesh(new THREE.TorusGeometry(.46,.035,8,28),new THREE.MeshBasicMaterial({color:"#FFFFFF",transparent:true,opacity:.55,blending:THREE.AdditiveBlending,depthWrite:false}));
        ring2.rotation.y=Math.PI/2;ring2.rotation.x=Math.PI/3;g.add(ring2);
        g.position.copy(pointPosition(THREE,p,pick.lane,1.12));orientAt(g,pick.pointIndex);scene.add(g);
        pickupVisuals.set(pick.id,{group:g,hiddenUntil:0,phase:pickIndex*.83});
      }

      const finishIndex=safeRaceGatePoint(manifest.points,0,manifest.plungeLaunchIndex),finishP=manifest.points[finishIndex]!,finish=makeCheckeredGate(THREE,finishP.width,"START / FINISH",style.accent);finish.position.copy(pointPosition(THREE,finishP,0,.03));orientAt(finish,finishIndex);scene.add(finish);
      const checkpointGates:import("three").Group[]=[];for(const [i,fraction] of [0.333,0.666].entries()){const target=Math.round(manifest.points.length*fraction)%manifest.points.length,pi=safeRaceGatePoint(manifest.points,target,manifest.plungeLaunchIndex),p=manifest.points[pi]!,gate=makeCheckeredGate(THREE,p.width,`CHECKPOINT ${i+1}`,style.marbleSecondary,true);gate.position.copy(pointPosition(THREE,p,0,.03));orientAt(gate,pi);scene.add(gate);checkpointGates.push(gate)}

      const orbGeo=new THREE.SphereGeometry(PHYSICS.ballRadius,30,22),coreGeo=new THREE.SphereGeometry(PHYSICS.ballRadius*.66,22,16);const racers:Racer[]=[];
      const spawnP=manifest.points[0]!,spawnT=new THREE.Vector3(spawnP.tangentX,0,spawnP.tangentZ).normalize(),spawnR=new THREE.Vector3(spawnP.rightX,spawnP.rightY,spawnP.rightZ).normalize();
      for(let i=0;i<playerCount;i++){
        const human=i===0,row=Math.floor(i/7),col=i%7,lane=(col-3)/3.4,back=row*1.55+1.2;const x=spawnP.x+spawnR.x*lane*spawnP.width*.43-spawnT.x*back,z=spawnP.z+spawnR.z*lane*spawnP.width*.43-spawnT.z*back,y=spawnP.y+1.0+spawnR.y*lane*spawnP.width*.43;
        const color=human?style.marble:orbColor(i,rand),secondary=human?style.marbleSecondary:color;const body=world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(x,y,z).setLinearDamping(.10).setAngularDamping(.16).setCcdEnabled(true));world.createCollider(RAPIER.ColliderDesc.ball(PHYSICS.ballRadius).setDensity(1).setFriction(1.08).setRestitution(.12),body);
        const mat=makeOrbMaterial(THREE,color,secondary,style.accent),mesh=new THREE.Mesh(orbGeo,mat),core=new THREE.Mesh(coreGeo,new THREE.MeshBasicMaterial({color:secondary,transparent:true,opacity:.24,blending:THREE.AdditiveBlending,depthWrite:false}));mesh.add(core);const label=makePfp(THREE,human?"Y":names[(i-1)%names.length]||"O",color);scene.add(mesh,label);const cloud=makeCloud(THREE,secondary);scene.add(cloud);
        racers.push({id:`racer-${i}`,username:human?"@you":`@${names[(i-1)%names.length]}`,color,body,mesh,core,label,visualPos:new THREE.Vector3(x,y,z),visualQuat:new THREE.Quaternion(),isHuman:human,pointIndex:0,previousPointIndex:0,lap:0,lapArmed:false,finishedAt:null,jumpReadyAt:0,boostUntil:0,slowedUntil:0,item:null,pickupReady:new Map(),recovering:false,rescueStartedAt:0,rescueUntil:0,rescueFrom:new THREE.Vector3(),rescuePointIndex:0,rescueGraceUntil:0,cloud,botLane:lane,botLaneTarget:lane,botThinkAt:0,lastHitAt:0,plungeAirUntil:0,plungeLaunchLockUntil:0});
      }
      const human=racers[0]!;
      const missiles:Missile[]=[],bombs:Bomb[]=[],explosions:Array<{mesh:import("three").Mesh;born:number}>=[];
      const missileGeo=new THREE.SphereGeometry(.19,10,8),missileMat=new THREE.MeshBasicMaterial({color:"#FF9A3C",transparent:true,opacity:.96,blending:THREE.AdditiveBlending});
      const bombGeo=new THREE.SphereGeometry(.31,12,9),bombMat=new THREE.MeshBasicMaterial({color:"#28020A"}),bombRingGeo=new THREE.TorusGeometry(.6,.055,8,28),bombRingMat=new THREE.MeshBasicMaterial({color:"#FF4D72",transparent:true,opacity:.8,blending:THREE.AdditiveBlending,depthWrite:false});
      const explosionGeo=new THREE.SphereGeometry(1,14,10),explosionMat=new THREE.MeshBasicMaterial({color:"#FF6B54",transparent:true,opacity:.72,blending:THREE.AdditiveBlending,depthWrite:false});
      const makeMissile=()=>{const g=new THREE.Group();const m=new THREE.Mesh(missileGeo,missileMat);g.add(m);const tail=new THREE.Mesh(new THREE.ConeGeometry(.13,.65,8),missileMat);tail.rotation.x=-Math.PI/2;tail.position.z=.38;g.add(tail);scene.add(g);return g};
      const makeBomb=()=>{const g=new THREE.Group();const m=new THREE.Mesh(bombGeo,bombMat),r=new THREE.Mesh(bombRingGeo,bombRingMat);r.rotation.x=Math.PI/2;g.add(m,r);scene.add(g);return g};
      const hitRacer=(target:Racer,attacker:Racer,now:number,power=1)=>{if(target.recovering||target.finishedAt||now-target.lastHitAt<420)return;target.lastHitAt=now;const tp=target.body.translation(),ap=attacker.body.translation(),dx=tp.x-ap.x,dz=tp.z-ap.z,mag=Math.hypot(dx,dz)||1;target.body.applyImpulse({x:dx/mag*1.45*power,y:.8*power,z:dz/mag*1.45*power},true);const v=target.body.linvel();target.body.setLinvel({x:v.x*.64,y:v.y,z:v.z*.64},true);target.slowedUntil=now+760;if(target.isHuman){setEventText("HIT · HOLD YOUR LINE");audio.hit()}};
      const makeExplosion=(position:{x:number;y:number;z:number})=>{const mesh=new THREE.Mesh(explosionGeo,explosionMat.clone());mesh.position.set(position.x,position.y+.35,position.z);mesh.scale.setScalar(.15);scene.add(mesh);explosions.push({mesh,born:performance.now()})};
      const useWeapon=(o:Racer,now:number)=>{
        const kind=o.item;if(!kind)return;
        const p=o.body.translation(),rp=manifest.points[o.pointIndex]!,forward=new THREE.Vector3(rp.tangentX,0,rp.tangentZ).normalize();
        if(kind==="missile"){
          const mesh=makeMissile();
          const center=new THREE.Vector3(rp.x,rp.y,rp.z),offset=new THREE.Vector3(p.x-rp.x,p.y-rp.y,p.z-rp.z);
          const lane=clamp((offset.x*rp.rightX+offset.y*rp.rightY+offset.z*rp.rightZ)/Math.max(1,rp.width),-.42,.42);
          const pos=pointPosition(THREE,rp,lane,.82).addScaledVector(forward,1.1);mesh.position.copy(pos);
          missiles.push({mesh,owner:o,born:now,life:2600,position:pos,progress:o.pointIndex+1.0,lane,speed:29.5});
          if(o.isHuman){audio.missile();setEventText("PULSE LANCE · TRACK LOCK")}
        }else if(kind==="bomb"){
          const mesh=makeBomb(),pos=new THREE.Vector3(p.x,p.y-.2,p.z).addScaledVector(forward,-1.25);mesh.position.copy(pos);
          bombs.push({mesh,owner:o,born:now,armedAt:now+520,expiresAt:now+9000,position:pos,hit:new Set()});
          if(o.isHuman){audio.bomb();setEventText("BOMB · DROPPED")}
        }else{
          o.boostUntil=Math.max(o.boostUntil,now+3400);
          const v=o.body.linvel();const turboSpeed=config.boostSpeed*1.12;
          o.body.setLinvel({x:forward.x*Math.max(turboSpeed,Math.hypot(v.x,v.z)),y:v.y,z:forward.z*Math.max(turboSpeed,Math.hypot(v.x,v.z))},true);
          if(o.isHuman){audio.turbo();setEventText("TURBO · 3.4 SECONDS")}
        }
        o.item=null;if(o.isHuman)setItem(null)
      };
      const grounded=(o:Racer)=>{if(o.recovering)return false;const p=o.body.translation(),rp=manifest.points[o.pointIndex]!,v=o.body.linvel();return !rp.gap&&Math.abs(p.y-rp.y)<1.55&&Math.abs(v.y)<2.4};
      const jump=(o:Racer,now:number)=>{if(now<o.jumpReadyAt)return false;const onGround=grounded(o);const onHeroRamp=circularPointDistance(o.pointIndex,manifest.plungeLaunchIndex,manifest.points.length)<=7&&(onGround||now<o.plungeLaunchLockUntil+220);if(!onGround&&!onHeroRamp)return false;const v=o.body.linvel();const jumpY=onHeroRamp?Math.max(v.y+config.jumpImpulse*1.15,config.jumpImpulse*1.9):Math.max(v.y,config.jumpImpulse);o.body.setLinvel({x:v.x,y:jumpY,z:v.z},true);o.jumpReadyAt=now+config.jumpCooldownMs;if(o.isHuman){audio.jump();if(onHeroRamp)setEventText("SUPER JUMP · EXTRA AIR")};return true};
      const action=(o:Racer)=>{if(phaseRef.current!=="playing"||o.recovering||o.finishedAt)return;const now=performance.now();jump(o,now);useWeapon(o,now)};actionRef.current=()=>action(human);

      let live=false,resolved=false,matchStart=0,lastUi=0,acc=0,prev=performance.now(),simTime=0,lastHumanPlace=playerCount;const phaseRef={current:"ready" as Phase};
      const setRacePhase=(p:Phase)=>{phaseRef.current=p;setPhase(p)};
      startRef.current=()=>{if(phaseRef.current!=="ready")return;void audio.start();setRacePhase("countdown");let n=3;setCountdown(n);const id=window.setInterval(()=>{n-=1;if(n>0){setCountdown(n);return}window.clearInterval(id);setCountdown(0);setEventText("GO!");setRacePhase("playing");matchStart=performance.now();live=true;for(const o of racers){const rp=manifest.points[o.pointIndex]!,v=new THREE.Vector3(rp.tangentX,0,rp.tangentZ).normalize().multiplyScalar(o.isHuman?0:config.baseSpeed*.72);o.body.setLinvel({x:v.x,y:0,z:v.z},true)}},760)};

      const beginRescue=(o:Racer,now:number)=>{if(o.recovering||o.finishedAt||now<o.rescueGraceUntil)return;o.recovering=true;o.rescueStartedAt=now;o.rescueUntil=now+RACE_RESCUE_MS;const p=o.body.translation();o.rescueFrom.set(p.x,p.y,p.z);o.rescuePointIndex=safeRaceRecoveryPoint(manifest.points,o.pointIndex,manifest.plungeLaunchIndex);o.body.setEnabled(false);if(o.isHuman){audio.rescue();setEventText("NIMBUS RESCUE · SAFE ROAD IN 3")}};
      const finishRescue=(o:Racer)=>{const rp=manifest.points[o.rescuePointIndex]!,safe=pointPosition(THREE,rp,0,1.18);o.body.setTranslation({x:safe.x,y:safe.y,z:safe.z},false);o.body.setRotation({x:0,y:0,z:0,w:1},false);o.visualPos.copy(safe);o.visualQuat.identity();o.mesh.position.copy(safe);o.body.setEnabled(true);o.body.setLinvel({x:o.isHuman?0:rp.tangentX*config.baseSpeed*.65,y:0,z:o.isHuman?0:rp.tangentZ*config.baseSpeed*.65},true);o.pointIndex=rp.index;o.previousPointIndex=rp.index;o.plungeAirUntil=0;o.plungeLaunchLockUntil=0;if(o.isHuman)humanFacing.set(rp.tangentX,0,rp.tangentZ).normalize();o.rescueGraceUntil=performance.now()+1450;o.recovering=false;o.cloud.visible=false;if(o.isHuman)setEventText("BACK ON TRACK · GO!")};

      const updateItems=(o:Racer,now:number)=>{if(o.recovering||o.finishedAt)return;if(circularPointDistance(o.pointIndex,manifest.plungeLaunchIndex,manifest.points.length)<=3&&(o.pickupReady.get(`plunge-launch-${o.lap}`)||0)<=now){o.pickupReady.set(`plunge-launch-${o.lap}`,now+120000);const rp=manifest.points[manifest.plungeLaunchIndex]!,touchdownIndex=(manifest.plungeLandIndex+14)%manifest.points.length,touchdown=manifest.points[touchdownIndex]!,bodyPos=o.body.translation(),dx=touchdown.x-bodyPos.x,dz=touchdown.z-bodyPos.z,horizontal=Math.hypot(dx,dz),flightSeconds=clamp(3.75+horizontal/170,3.75,4.55),dy=(touchdown.y+1.15)-bodyPos.y,launchY=(dy+4.905*flightSeconds*flightSeconds)/flightSeconds,incomingY=Math.max(0,o.body.linvel().y),heroY=Math.max(launchY*1.08,launchY+incomingY*.82),horizontalSpeed=Math.max(horizontal/flightSeconds*1.08,15.5),hm=Math.max(1e-6,horizontal);o.body.setLinvel({x:dx/hm*horizontalSpeed,y:heroY,z:dz/hm*horizontalSpeed},true);o.plungeLaunchLockUntil=now+900;o.plungeAirUntil=now+(flightSeconds+1.15)*1000;o.boostUntil=Math.max(o.boostUntil,now+2100);if(o.isHuman){audio.boost();setEventText("ORBITAL PLUNGE · BIG AIR")}}

        // Separate continuous-road Gravity Dive: 2–3 seconds of real ballistic free fall.
        if(circularPointDistance(o.pointIndex,manifest.gravityDiveCrestIndex,manifest.points.length)<=2&&(o.pickupReady.get(`gravity-dive-${o.lap}`)||0)<=now){
          o.pickupReady.set(`gravity-dive-${o.lap}`,now+120000);
          const catchP=manifest.points[manifest.gravityDiveCatchIndex]!,bodyPos=o.body.translation();
          const dx=catchP.x-bodyPos.x,dz=catchP.z-bodyPos.z,horizontal=Math.hypot(dx,dz),flightSeconds=clamp(2.35+horizontal/150,2.35,2.95);
          const dy=(catchP.y+1.10)-bodyPos.y,vy=(dy+4.905*flightSeconds*flightSeconds)/flightSeconds,hm=Math.max(1e-6,horizontal),horizontalSpeed=Math.max(horizontal/flightSeconds*1.025,config.baseSpeed*.92);
          o.body.setLinvel({x:dx/hm*horizontalSpeed,y:Math.min(1.2,vy),z:dz/hm*horizontalSpeed},true);
          o.plungeLaunchLockUntil=now+520;o.plungeAirUntil=now+(flightSeconds+.65)*1000;
          if(o.isHuman){audio.boost();setEventText("GRAVITY DIVE · FREE FALL")}
        }

        for(const ramp of manifest.ramps){if(circularPointDistance(o.pointIndex,ramp.pointIndex,manifest.points.length)>2)continue;if((o.pickupReady.get(ramp.id)||0)>now)continue;const rp=manifest.points[o.pointIndex]!,p=o.body.translation(),center=pointPosition(THREE,rp,ramp.lane,0);if(Math.hypot(p.x-center.x,p.z-center.z)>rp.width*.24)continue;o.pickupReady.set(ramp.id,now+1800);o.boostUntil=Math.max(o.boostUntil,now+720);if(o.isHuman){audio.boost();setEventText("RAMP CHARGE · FLY")}}for(const [i,b] of manifest.boosts.entries()){if(circularPointDistance(o.pointIndex,b.pointIndex,manifest.points.length)>2)continue;if((o.pickupReady.get(b.id)||0)>now)continue;const rp=manifest.points[o.pointIndex]!,p=o.body.translation(),center=pointPosition(THREE,rp,b.lane,0),lateral=Math.hypot(p.x-center.x,p.z-center.z);if(lateral>rp.width*.22)continue;o.pickupReady.set(b.id,now+1600);o.boostUntil=now+1250;if(o.isHuman){audio.boost();setEventText("SPEED CHARGE")}}if(o.item)return;for(const pick of manifest.pickups){if(circularPointDistance(o.pointIndex,pick.pointIndex,manifest.points.length)>2)continue;if((pickupCooldowns.get(pick.id)||0)>now)continue;const rp=manifest.points[o.pointIndex]!,p=o.body.translation(),center=pointPosition(THREE,rp,pick.lane,1),d=Math.hypot(p.x-center.x,p.z-center.z);if(d>rp.width*.24)continue;o.item=pick.kind;const respawnAt=now+2600;pickupCooldowns.set(pick.id,respawnAt);const visual=pickupVisuals.get(pick.id);if(visual){visual.hiddenUntil=respawnAt;visual.group.visible=false;visual.group.scale.setScalar(.08)}if(o.isHuman){setItem(pick.kind);audio.pickup();setEventText(pick.kind==="missile"?"⚡ PULSE LANCE ACQUIRED":pick.kind==="bomb"?"💣 BOMB ACQUIRED":"💨 TURBO ACQUIRED")}break}};

      const botSteer=(o:Racer,now:number)=>{if(now>=o.botThinkAt){const rank=racers.filter(r=>!r.finishedAt).sort((a,b)=>raceProgress(b.pointIndex,b.lap,manifest.points.length)-raceProgress(a.pointIndex,a.lap,manifest.points.length)).indexOf(o);const desperation=clamp(rank/Math.max(1,playerCount-1),0,1);o.botLaneTarget=clamp(o.botLaneTarget+(rand()-.5)*(.34+desperation*.18),-.68,.68);if(rand()<.16)o.botLaneTarget=(rand()-.5)*1.25;o.botThinkAt=now+420+rand()*650;if(o.item&&rand()<.32)action(o);else if(rand()<.055)jump(o,now)}o.botLane+=(o.botLaneTarget-o.botLane)*.028;return clamp(o.botLane*1.22,-1,1)};

      const updateProjectiles=(now:number,dt:number)=>{
        const avgStep=manifest.lapLength/manifest.points.length;
        for(let i=missiles.length-1;i>=0;i--){
          const m=missiles[i]!,age=now-m.born;
          if(age>m.life){scene.remove(m.mesh);missiles.splice(i,1);continue}
          m.progress+=m.speed*dt/Math.max(.5,avgStep);
          const base=Math.floor(m.progress),frac=m.progress-base,p0=manifest.points[((base%manifest.points.length)+manifest.points.length)%manifest.points.length]!,p1=manifest.points[(p0.index+1)%manifest.points.length]!;
          if(p0.gap||p1.gap){
            // Pulse rides an invisible race-line bridge across the hero gap rather than diving into space.
          }
          const cx=p0.x+(p1.x-p0.x)*frac,cy=p0.y+(p1.y-p0.y)*frac,cz=p0.z+(p1.z-p0.z)*frac;
          const rx=p0.rightX+(p1.rightX-p0.rightX)*frac,ry=p0.rightY+(p1.rightY-p0.rightY)*frac,rz=p0.rightZ+(p1.rightZ-p0.rightZ)*frac,width=p0.width+(p1.width-p0.width)*frac;
          const next=new THREE.Vector3(cx+rx*width*m.lane,cy+ry*width*m.lane+.82,cz+rz*width*m.lane);
          const direction=next.clone().sub(m.position).normalize();m.position.copy(next);m.mesh.position.copy(next);m.mesh.lookAt(next.clone().add(direction));
          let hit=false;
          for(const o of racers){if(o===m.owner||o.recovering||o.finishedAt)continue;const p=o.body.translation();if(Math.hypot(p.x-next.x,p.y-next.y,p.z-next.z)<1.0){hitRacer(o,m.owner,now,1.08);if(o.isHuman||m.owner.isHuman)audio.hit();hit=true;break}}
          if(hit){scene.remove(m.mesh);missiles.splice(i,1)}
        }
        for(let i=bombs.length-1;i>=0;i--){
          const b=bombs[i]!;b.mesh.rotation.y+=dt*1.8;(b.mesh.children[1] as import("three").Mesh).rotation.z+=dt*2.5;
          if(now>=b.expiresAt){scene.remove(b.mesh);bombs.splice(i,1);continue}
          if(now<b.armedAt)continue;
          let detonated=false;
          for(const o of racers){
            if(o===b.owner||o.recovering||o.finishedAt||b.hit.has(o.id))continue;
            const p=o.body.translation();
            if(Math.hypot(p.x-b.position.x,p.z-b.position.z)<1.6&&Math.abs(p.y-b.position.y)<2.2){
              b.hit.add(o.id);o.lastHitAt=now;
              const v=o.body.linvel(),dx=p.x-b.position.x,dz=p.z-b.position.z,mag=Math.hypot(dx,dz)||1;
              // Bombs are intentionally much more disruptive than Pulse hits: near-stop + pop + wobble.
              o.body.setLinvel({x:v.x*.16,y:Math.max(v.y,2.2),z:v.z*.16},true);
              o.body.applyImpulse({x:dx/mag*2.8,y:1.7,z:dz/mag*2.8},true);o.slowedUntil=now+1450;
              makeExplosion(b.position);if(o.isHuman||b.owner.isHuman)audio.explosion();
              if(o.isHuman)setEventText("💥 BOMB HIT · SPEED KILLED");
              detonated=true;break
            }
          }
          if(detonated){scene.remove(b.mesh);bombs.splice(i,1)}
        }
        for(let i=explosions.length-1;i>=0;i--){
          const e=explosions[i]!,age=(now-e.born)/1000;
          if(age>.48){scene.remove(e.mesh);(e.mesh.material as import("three").Material).dispose();explosions.splice(i,1);continue}
          e.mesh.scale.setScalar(.15+age*5.8);(e.mesh.material as import("three").MeshBasicMaterial).opacity=Math.max(0,.72*(1-age/.48));
        }
      };

      const rankOf=(target:Racer)=>{const ordered=[...racers].sort((a,b)=>{if(a.finishedAt&&b.finishedAt)return a.finishedAt-b.finishedAt;if(a.finishedAt)return -1;if(b.finishedAt)return 1;return raceProgress(b.pointIndex,b.lap,manifest.points.length)-raceProgress(a.pointIndex,a.lap,manifest.points.length)});return ordered.indexOf(target)+1};
      const updateDraft=(now:number)=>{let active=false;const hp=human.body.translation(),hprog=raceProgress(human.pointIndex,human.lap,manifest.points.length);for(const o of racers){if(o===human||o.finishedAt||o.recovering)continue;const d=raceProgress(o.pointIndex,o.lap,manifest.points.length)-hprog;if(d<=0||d>6)continue;const p=o.body.translation();if(Math.hypot(p.x-hp.x,p.z-hp.z)<7.8){active=true;human.boostUntil=Math.max(human.boostUntil,now+260);break}}setWake(active)};

      const resize=()=>{const r=mount.getBoundingClientRect();renderer.setSize(Math.max(1,r.width),Math.max(1,r.height),false);camera.aspect=r.width/Math.max(1,r.height);camera.updateProjectionMatrix()};const ro=new ResizeObserver(resize);ro.observe(mount);resize();renderer.compile(scene,camera);renderer.render(scene,camera);
      const camPos=new THREE.Vector3(),camLook=new THREE.Vector3(),forward=new THREE.Vector3(),rightV=new THREE.Vector3(),desired=new THREE.Vector3(),smoothForward=spawnT.clone(),humanFacing=spawnT.clone(),targetLook=new THREE.Vector3(),cameraMatrix=new THREE.Matrix4(),cameraTargetQuat=new THREE.Quaternion();let perfFrames=0,perfWindowStart=performance.now();
      const render=(ms:number)=>{if(cancelled)return;frame=requestAnimationFrame(render);const dt=Math.min(.05,(ms-prev)/1000);prev=ms;(trackMat.uniforms.uTime.value as number)=ms;ring.rotation.y+=dt*.018;perfFrames+=1;if(ms-perfWindowStart>2200){const fps=perfFrames*1000/Math.max(1,ms-perfWindowStart),next=fps<50?Math.max(.82,renderDpr-.12):fps>58?Math.min(maxDpr,renderDpr+.05):renderDpr;if(Math.abs(next-renderDpr)>.02){renderDpr=next;renderer.setPixelRatio(renderDpr);resize()}perfFrames=0;perfWindowStart=ms;}for(const visual of pickupVisuals.values()){const g=visual.group;if(ms<visual.hiddenUntil){g.visible=false;continue}if(!g.visible){g.visible=true;g.scale.setScalar(.08)}const respawnScale=1-Math.exp(-dt*12);g.scale.lerp(new THREE.Vector3(1,1,1),respawnScale);g.rotation.z+=dt*.78;(g.children[1] as import("three").Mesh).rotation.y+=dt*2.8;(g.children[2] as import("three").Mesh).rotation.z-=dt*1.7;g.position.y+=Math.sin(ms*.0022+visual.phase)*.0009}for(const b of boostMeshes)b.material instanceof THREE.MeshBasicMaterial&&(b.material.opacity=.62+Math.sin(ms*.006+b.position.x)*.18);
        if(live){const now=performance.now(),elapsedNow=(now-matchStart)/1000;acc+=dt;while(acc>=PHYSICS.fixedStep){simTime+=PHYSICS.fixedStep;for(const o of racers){if(o.finishedAt)continue;if(o.recovering){if(now>=o.rescueUntil)finishRescue(o);continue}const p=o.body.translation(),nearest=nearestRacePoint(manifest.points,p.x,p.y,p.z,o.pointIndex),rp=nearest.point;o.previousPointIndex=o.pointIndex;o.pointIndex=rp.index;if(o.pointIndex>manifest.points.length*.24)o.lapArmed=true;if(o.lapArmed&&isForwardLapWrap(o.previousPointIndex,o.pointIndex,manifest.points.length)){o.lap+=1;o.lapArmed=false;if(o.isHuman){audio.lap();setLap(Math.min(config.laps,o.lap+1));setEventText(o.lap>=config.laps-1?"FINAL LAP":"LAP COMPLETE")};if(o.lap>=config.laps){o.finishedAt=now;o.body.setLinvel({x:0,y:o.body.linvel().y,z:0},true);if(!resolved){resolved=true;setWinner(o.username);if(o.isHuman){setRacePhase("won");audio.victory()}else setEventText(`${o.username} WINS · FINISH YOUR RACE`)}else if(o.isHuman){setRacePhase("finished")}continue}}
          const trackDistance=Math.sqrt(nearest.distanceSq),fallThreshold=rp.y-8.5;if(now>=o.rescueGraceUntil&&now>=o.plungeAirUntil&&(p.y<fallThreshold||trackDistance>rp.width*2.25)){beginRescue(o,now);continue}
          updateItems(o,now);
          const k=controlsRef.current,rawHumanSteer=coarse?k.touchX:(k.left?-1:0)+(k.right?1:0),steer=o.isHuman?rawHumanSteer:botSteer(o,now);
          const v=o.body.linvel(),air=!grounded(o),slow=now<o.slowedUntil?.72:1,boost=now<o.boostUntil,throttle=o.isHuman?(k.up?1:0):1,brake=o.isHuman&&k.down;
          let targetSpeed=throttle?(boost?config.boostSpeed:config.baseSpeed):0;
          if(throttle)targetSpeed+=Math.max(0,-rp.tangentY)*13;
          if(brake)targetSpeed*=.22;
          targetSpeed*=slow;
          forward.set(rp.tangentX,0,rp.tangentZ).normalize();
          rightV.set(rp.rightX,0,rp.rightZ).normalize();
          const currentSpeed=Math.hypot(v.x,v.z),desiredSpeed=clamp(targetSpeed,0,boost?config.boostSpeed:config.maxSpeed+Math.max(0,-rp.tangentY)*12);

          if(o.isHuman){
            // V9: Arena-style controls, but the DRIVER owns forward direction.
            // The track/camera no longer redefine "forward" every fixed step.
            let sx=(k.right?1:0)-(k.left?1:0),sy=(k.up?1:0)-(k.down?1:0);
            if(coarse){sx=k.touchX;sy=k.up?1:(k.down?-1:0)}

            // RACE is a forward track game rather than a free-roaming Arena.
            // Keep Arena's proven movement/sign convention, but narrow lateral authority.
            // Ground: ~30% calmer left/right.
            // Air: only light correction so jumps preserve launch momentum.
            const lateralAuthority=air?0.20:0.70;
            sx*=lateralAuthority;

            const facingX=humanFacing.x,facingZ=humanFacing.z;
            const driverRightX=-facingZ,driverRightZ=facingX;
            const worldX=driverRightX*sx+facingX*sy;
            const worldZ=driverRightZ*sx+facingZ*sy;
            const inputX=worldX,inputY=-worldZ;

            // Same concept Arena uses with lastFacing: player input rotates a persistent
            // heading, then the camera follows it. The camera never creates that heading.
            if(Math.hypot(worldX,worldZ)>.2){
              const desiredHeading=new THREE.Vector3(worldX,0,worldZ).normalize();
              humanFacing.lerp(desiredHeading,air?.006:.022).normalize();
            }

            if(now<o.plungeLaunchLockUntil){
              /* preserve authored hero takeoff while the rigid body clears the ramp */
            }else if(now<o.plungeAirUntil&&air){
              /* preserve ballistic horizontal velocity; Rapier gravity owns Y */
            }else{
              const profile=coarse?"mobile":"desktop";
              const arenaMax=profile==="desktop"?PHYSICS.desktopMaxSpeed:PHYSICS.mobileMaxSpeed;

              // Run the exact Arena controller in normalized Arena-speed space,
              // then scale the result back up to RACE pace.
              const raceSpeed=boost?config.boostSpeed:(throttle?desiredSpeed:Math.min(desiredSpeed,config.baseSpeed));
              const raceMul=Math.max(1,raceSpeed/Math.max(.01,arenaMax));
              const steerBase=nextPlanarVelocity(
                {x:v.x/raceMul,z:v.z/raceMul},
                inputX,
                inputY,
                profile,
              );
              let nx=steerBase.x*raceMul,nz=steerBase.z*raceMul;

              // Preserve the race's downhill speed reward without altering Arena's steering feel.
              if(throttle&&!brake){
                const downhillBonus=Math.max(0,-rp.tangentY)*5.5;
                if(downhillBonus>0){
                  const mag=Math.hypot(nx,nz)||1;
                  const boosted=Math.min(config.maxSpeed+downhillBonus,mag+downhillBonus);
                  nx=nx/mag*boosted;nz=nz/mag*boosted;
                }
              }

              o.body.setLinvel({x:nx,y:v.y,z:nz},true);
              const actualMag=Math.hypot(nx,nz);
              if(actualMag>.75){
                const actualHeading=new THREE.Vector3(nx/actualMag,0,nz/actualMag);
                humanFacing.lerp(actualHeading,air?.018:.070).normalize();
              }
            }
          }else{
            // Bots remain spline-guided so the 50-racer admin lab continues to stress traffic.
            desired.copy(forward).addScaledVector(rightV,steer*config.steeringStrength).normalize();
            const response=air?.048:.115;
            if(now<o.plungeLaunchLockUntil){
              /* preserve hero launch */
            }else if(now<o.plungeAirUntil&&air){
              /* preserve ballistic flight */
            }else{
              const tx=desired.x*desiredSpeed,tz=desired.z*desiredSpeed;
              let nx=v.x+(tx-v.x)*response,nz=v.z+(tz-v.z)*response;
              if(currentSpeed>desiredSpeed*1.08&&desiredSpeed>0){
                const f=desiredSpeed/currentSpeed;nx*=f;nz*=f;
              }
              o.body.setLinvel({x:nx,y:v.y,z:nz},true);
            }
          }}world.step();updateProjectiles(now,PHYSICS.fixedStep);acc-=PHYSICS.fixedStep}updateDraft(now);if(ms-lastUi>90){lastUi=ms;const v=human.body.linvel();setElapsed(elapsedNow);setSpeed(Math.hypot(v.x,v.z));const currentPlace=rankOf(human);setPlace(currentPlace);if(currentPlace<lastHumanPlace&&lastHumanPlace-currentPlace<=3&&elapsedNow>3){audio.overtake();setEventText(`OVERTAKE · P${currentPlace}`)}lastHumanPlace=currentPlace;setItem(human.item);if(human.recovering)setRescueLeft(Math.max(0,(human.rescueUntil-now)/1000));else setRescueLeft(0);audio.setSpeed(Math.hypot(v.x,v.z))}}
        for(const o of racers){const mat=o.mesh.material as import("three").ShaderMaterial;mat.uniforms.uTime.value=ms;if(o.recovering){const t=clamp((ms-o.rescueStartedAt)/RACE_RESCUE_MS,0,1),rp=manifest.points[o.rescuePointIndex]!,end=pointPosition(THREE,rp,0,1.25),arc=Math.sin(t*Math.PI)*5.2;o.mesh.position.lerpVectors(o.rescueFrom,end,t);o.mesh.position.y+=arc;o.label.position.set(o.mesh.position.x,o.mesh.position.y-.22,o.mesh.position.z);o.cloud.visible=true;o.cloud.position.copy(o.mesh.position);o.cloud.position.y-=.68;o.cloud.rotation.y+=dt*1.2;continue}o.cloud.visible=false;
          const p=o.body.translation(),q=o.body.rotation(),v=o.body.linvel(),sp=Math.hypot(v.x,v.z);
          const posTarget=new THREE.Vector3(p.x,p.y,p.z),quatTarget=new THREE.Quaternion(q.x,q.y,q.z,q.w);
          // Presentation smoothing decouples 60 Hz Rapier updates from 60/120/144 Hz rendering.
          // A high damping rate removes the visible stair-step without making controls feel laggy.
          const posBlend=1-Math.exp(-dt*30),rotBlend=1-Math.exp(-dt*26);
          o.visualPos.lerp(posTarget,posBlend);o.visualQuat.slerp(quatTarget,rotBlend);
          o.mesh.position.copy(o.visualPos);o.mesh.quaternion.copy(o.visualQuat);
          o.label.position.set(o.visualPos.x,o.visualPos.y-.22,o.visualPos.z);
          mat.uniforms.uSpeed.value=sp;o.core.scale.setScalar(1+clamp((sp-config.baseSpeed)/12,0,.22))}
        const hv=human.body.linvel(),hs=Math.hypot(hv.x,hv.z),hp=human.recovering?human.mesh.position:human.visualPos,rp=manifest.points[human.pointIndex]!,lookAhead=manifest.points[(human.pointIndex+Math.round(7+clamp(hs,0,25)*.22))%manifest.points.length]!;
        // Driver-led camera: actual Orb travel steers the camera; the spline only supplies
        // a small vertical anticipation term so giant hills remain readable.
        if(hs>.8){const velocityHeading=new THREE.Vector3(hv.x/hs,0,hv.z/hs);humanFacing.lerp(velocityHeading,1-Math.exp(-dt*5.8)).normalize()}
        smoothForward.lerp(humanFacing,1-Math.exp(-dt*4.6)).normalize();
        const back=mobileish?11.0:10.0,height=mobileish?5.8:5.25;desired.set(hp.x-smoothForward.x*back,hp.y+height,hp.z-smoothForward.z*back);camPos.lerp(desired,1-Math.exp(-dt*5.4));camera.position.copy(camPos);
        targetLook.set(hp.x+smoothForward.x*(5.0+hs*.30),hp.y+.52+Math.max(-.5,Math.min(1.2,lookAhead.tangentY))*1.15,hp.z+smoothForward.z*(5.0+hs*.30));camLook.lerp(targetLook,1-Math.exp(-dt*6.2));cameraMatrix.lookAt(camera.position,camLook,camera.up);cameraTargetQuat.setFromRotationMatrix(cameraMatrix);camera.quaternion.slerp(cameraTargetQuat,1-Math.exp(-dt*8.5));const targetFov=clamp(58+(hs-config.baseSpeed)*1.05,58,71);camera.fov+=(targetFov-camera.fov)*(1-Math.exp(-dt*4.4));camera.updateProjectionMatrix();renderer.render(scene,camera)};
      camPos.copy(pointPosition(THREE,spawnP,0,6)).addScaledVector(spawnT,-10);render(performance.now());
      cleanupThree=()=>{cancelAnimationFrame(frame);ro.disconnect();audio.stop();scene.traverse((obj:import("three").Object3D)=>{if(obj instanceof THREE.Mesh||obj instanceof THREE.LineSegments||obj instanceof THREE.Points){const geo=(obj as import("three").Mesh).geometry;geo?.dispose?.();const material=(obj as import("three").Mesh).material;if(Array.isArray(material))material.forEach(m=>m.dispose());else material?.dispose?.()}});renderer.dispose();mount.innerHTML=""};
    })();
    return()=>{cancelled=true;cleanupThree?.();audio.stop();window.removeEventListener("keydown",kd);window.removeEventListener("keyup",ku)};
  },[config,manifest,playerCount,seed,style,generation]);

  const touchStart=useCallback((e:React.PointerEvent<HTMLDivElement>)=>e.currentTarget.setPointerCapture(e.pointerId),[]);
  const touchMove=useCallback((e:React.PointerEvent<HTMLDivElement>)=>{if(!e.currentTarget.hasPointerCapture(e.pointerId))return;const r=e.currentTarget.getBoundingClientRect(),x=(e.clientX-(r.left+r.width/2))/(r.width*.42);controlsRef.current.touchX=clamp(x,-1,1)},[]);
  const touchEnd=useCallback((e:React.PointerEvent<HTMLDivElement>)=>{controlsRef.current.touchX=0;try{e.currentTarget.releasePointerCapture(e.pointerId)}catch{}},[]);
  const itemLabel=item==="missile"?"PULSE":item==="bomb"?"BOMB":item==="turbo"?"TURBO":"EMPTY";

  return <div className="race-sandbox-game">
    <div ref={mountRef} className="race-sandbox-canvas"/>
    <div className="race-hud race-hud-top">
      <div><span>PLACE</span><strong>{place}<small>/{playerCount}</small></strong></div>
      <div className="race-event"><strong>{eventText}</strong><small>{fmt(elapsed)} · {Math.round(speed*3.6)} KM/H</small></div>
      <div><span>LAP</span><strong>{lap}<small>/{config.laps}</small></strong></div>
    </div>
    <div className="race-item-hud"><span>ITEM</span><strong className={item?"loaded":""}>{itemLabel}</strong>{wake?<em>ORB WAKE</em>:null}</div>
    {rescueLeft>0?<div className="race-rescue-hud"><strong>NIMBUS RESCUE</strong><span>{rescueLeft.toFixed(1)}s</span></div>:null}
    {phase==="ready"?<div className="arena-center-card race-center-card"><span>ADMIN ONLY · LOCAL LAB</span><h3>RACE</h3><p>Three laps on a never-before-seen Orbital Prismway. Arena-style controls, but your Orb now leads the camera instead of the track steering you. Every seed includes a randomized Gravity Dive plus the Orbital Plunge chasm. Draft other racers, hit speed charges, jump whenever you want, and use Space to jump + use a held weapon.</p><button className="btn-primary" onClick={()=>startRef.current()}>Start race test →</button></div>:null}
    {phase==="countdown"?<div className="arena-countdown race-countdown">{countdown||"GO"}</div>:null}
    {(phase==="won"||phase==="finished")?<div className="arena-result-card race-result-card"><span>RACE COMPLETE</span><h3>{phase==="won"?"YOU WIN":winner?`${winner} WINS`:"FINISHED"}</h3><p>Lap 3 crossing of START / FINISH is the finish. First valid finisher would own the authoritative prize result in production.</p></div>:null}
    {phase==="playing"?<div className="arena-jump-wrap race-action-wrap"><button className={`arena-jump race-action ${item?"armed":""}`} onClick={()=>actionRef.current()}><span>{item?`JUMP + ${item==="missile"?"FIRE":item==="bomb"?"DROP":"TURBO"}`:"JUMP"}</span></button></div>:null}
    {phase==="playing"&&controlMode==="touch"?<><div className="race-touch" onPointerDown={touchStart} onPointerMove={touchMove} onPointerUp={touchEnd} onPointerCancel={touchEnd}><i style={{transform:`translateX(${controlsRef.current.touchX*28}px)`}}/></div><button className="race-throttle" onPointerDown={(e)=>{e.preventDefault();controlsRef.current.up=true}} onPointerUp={()=>{controlsRef.current.up=false}} onPointerCancel={()=>{controlsRef.current.up=false}} onPointerLeave={()=>{controlsRef.current.up=false}}><span>GO</span></button></>:null}
    <div className="arena-control-hint race-control-hint"><span className="arena-desktop-hint">HOLD W / ↑ · ACCELERATE &nbsp;&nbsp; A / D OR ← / → · STEER &nbsp;&nbsp; S / ↓ · BRAKE &nbsp;&nbsp; SPACE · JUMP{item?" + USE ITEM":""}</span><span className="arena-mobile-hint">HOLD GO · STEER · JUMP{item?" + USE ITEM":""} · DRAFT · BOOST · 3 LAPS</span></div>
  </div>;
}
