import http from "node:http";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";
import RAPIER from "@dimforge/rapier3d-compat";

await RAPIER.init();

const PORT = Math.max(1, Number(process.env.PORT || 8080));
const HMAC_KEY = (process.env.ARENA_RUNTIME_HMAC_KEY || "").trim();
const SITE_URL = (process.env.ORBS_SITE_URL || "").trim().replace(/\/$/, "");
if (HMAC_KEY.length < 32) throw new Error("ARENA_RUNTIME_HMAC_KEY must be at least 32 characters");
if (!/^https?:\/\//.test(SITE_URL)) throw new Error("ORBS_SITE_URL must be the canonical https://orbs.meme site URL");
const SITE_ORIGIN = new URL(SITE_URL).origin;

const VERSION = "orb-arena-v8";
const FIXED = 1 / 60;
const BALL_RADIUS = .42;
const GRAVITY = 9.81;
const LINEAR_DAMPING = .5;
const ANGULAR_DAMPING = .18;
const FRICTION = .44;
const DESKTOP_MAX = 4.65;
const MOBILE_MAX = 4.55;
const JUMP_IMPULSE = 7.35;
const JUMP_COOLDOWN = 720;
const WEAPON_LIFETIME = 8000;
const RING_RESPAWN = 8500;
const PEDESTAL_RESPAWN = 11500;
const RECOVERY_AMOUNT = 28;
const HARD_CAP_MS = 10 * 60 * 1000;
const SNAPSHOT_MS = 50;
const LOBBY_GRACE_MS = 20_000;
const MAX_PLAYERS = 200;
const LOBBY_CLOSE_MS = 120_000;
const MAX_MESSAGES_PER_SECOND = 120;
const MAX_ACTIONS_PER_SECOND = 24;
const DISCONNECT_GRACE_MS = 20_000;
const HEARTBEAT_MS = 15_000;

const POWER_META = {
  superjump:{label:"DOUBLE JUMP",color:"#FFD86B"},
  blaster:{label:"BLASTER",color:"#FF8A4C"},
  superspeed:{label:"SUPER SPEED",color:"#72F7FF"},
};

function clamp(v,min,max){return Math.max(min,Math.min(max,v));}
function safeJson(raw){try{return JSON.parse(raw)}catch{return null}}
function sign(encoded){return createHmac("sha256",HMAC_KEY).update(encoded,"utf8").digest("base64url")}
function verifyToken(token){
  const parts=String(token||"").split("."); if(parts.length!==2)return null;
  const [encoded,supplied]=parts,expected=sign(encoded); const a=Buffer.from(expected),b=Buffer.from(supplied||"");
  if(a.length!==b.length||!timingSafeEqual(a,b))return null;
  const payload=safeJson(Buffer.from(encoded,"base64url").toString("utf8"));
  if(!payload||payload.schemaVersion!==1||!payload.orbId||!payload.slug||!payload.wallet||!payload.xUserId||payload.expiresAt<=Date.now())return null;
  if(payload.endsAt<=Date.now()||payload.startsAt>Date.now()+70_000)return null;
  return payload;
}
function arenaRadiusForPlayers(count){const p=Math.max(2,Math.min(MAX_PLAYERS,Math.floor(count)));return Math.min(74,Math.max(30,25+Math.sqrt(p)*2.35))}
function configFor(count){const radius=arenaRadiusForPlayers(count);return{radius,courseScale:radius/32,maxSeconds:600,suddenDeathAt:432,overchargeAt:528,jumpImpulse:JUMP_IMPULSE,jumpCooldownMs:JUMP_COOLDOWN,impactDamageScale:.72,weaponLifetimeMs:WEAPON_LIFETIME,ringRespawnMs:RING_RESPAWN,pedestalRespawnMs:PEDESTAL_RESPAWN,recoveryAmount:RECOVERY_AMOUNT}}
function quat(rx,ry,rz){
  const cx=Math.cos(rx/2),sx=Math.sin(rx/2),cy=Math.cos(ry/2),sy=Math.sin(ry/2),cz=Math.cos(rz/2),sz=Math.sin(rz/2);
  return {x:sx*cy*cz-cx*sy*sz,y:cx*sy*cz+sx*cy*sz,z:cx*cy*sz-sx*sy*cz,w:cx*cy*cz+sx*sy*sz};
}
function normalizeInput(x,z){x=clamp(Number(x)||0,-1,1);z=clamp(Number(z)||0,-1,1);const m=Math.hypot(x,z);return m>1?{x:x/m,z:z/m}:{x,z}}
function nextVelocity(current,input,profile){
  const max=profile==="mobile"?MOBILE_MAX:DESKTOP_MAX,desiredX=input.x*max,desiredZ=input.z*max,desired=Math.hypot(desiredX,desiredZ),before=Math.hypot(current.x,current.z),dot=current.x*desiredX+current.z*desiredZ;
  const reversing=desired>.05&&before>.18&&dot<0,response=desired<.05?(profile==="mobile"?3.5:4.2):reversing?(profile==="mobile"?8.6:10.5):(profile==="mobile"?4.8:5.4),blend=1-Math.exp(-response*FIXED);
  return{x:current.x+(desiredX-current.x)*blend,z:current.z+(desiredZ-current.z)*blend};
}
function clampVelocity(v,profile){const limit=profile==="mobile"?MOBILE_MAX:DESKTOP_MAX,s=Math.hypot(v.x,v.z);if(s<=limit||s<1e-9)return{x:v.x,z:v.z};const f=limit/s;return{x:v.x*f,z:v.z*f}}

class Room {
  constructor(payload){
    this.orbId=payload.orbId;this.slug=payload.slug;this.commitment=payload.commitment;this.style=payload.style;this.startsAt=payload.startsAt;this.endsAt=payload.endsAt;
    this.matchId=randomUUID();this.clients=new Map();this.players=new Map();this.phase="lobby";this.liveAt=Math.max(this.startsAt+LOBBY_GRACE_MS,Date.now()+5000);this.startedAt=0;this.completedAt=0;this.world=null;this.config=null;this.projectiles=[];this.pickups=[];this.pedestals=[];this.pairHits=new Map();this.lastSnapshot=0;this.resultPosted=false;this.resultPosting=false;this.seq=0;
    this.abortReason=null;this.resultRetryTimer=null;this.timer=setInterval(()=>this.tick(),1000/60);
  }
  compatible(p){return p.orbId===this.orbId&&p.slug===this.slug&&p.commitment===this.commitment&&p.startsAt===this.startsAt&&p.endsAt===this.endsAt}
  add(ws,p){
    if(!this.compatible(p))throw new Error("Arena token does not match room");
    let player=this.players.get(p.wallet);
    if(this.phase!=="lobby"&&!player)throw new Error("Arena entry is closed");
    if(!player){
      if(this.players.size>=MAX_PLAYERS)throw new Error("Arena is full");
      player={id:`p${this.players.size+1}`,wallet:p.wallet,xUserId:p.xUserId,username:p.username,profileImageUrl:p.profileImageUrl||null,color:p.orbColor,glow:p.orbGlow||p.orbColor,body:null,alive:true,health:100,input:{x:0,z:0},profile:"desktop",jumpReadyAt:0,airborne:false,descending:false,powerKind:null,powerExpiresAt:0,speedUntil:0,blasterActive:false,nextShotAt:0,doubleJumpArmed:false,connected:true,disconnectedAt:0,lastSeq:-1,damageDealt:0,knockouts:0};
      this.players.set(p.wallet,player);
    }
    const prior=this.clients.get(p.wallet);if(prior&&prior!==ws)try{prior.close(4001,"Arena reconnected elsewhere")}catch{}
    player.connected=true;player.disconnectedAt=0;player.lastSeq=-1;this.clients.set(p.wallet,ws);ws.player=player;ws.room=this;
    this.send(ws,{t:"welcome",matchId:this.matchId,playerId:player.id,phase:this.phase,liveAt:this.liveAt,version:VERSION,winnerId:this.winner?.id||null,abortReason:this.abortReason});
    this.broadcastRoster();
  }
  remove(ws){if(!ws.player)return;const p=ws.player;if(this.clients.get(p.wallet)!==ws)return;this.clients.delete(p.wallet);p.connected=false;p.disconnectedAt=Date.now();p.input={x:0,z:0};this.broadcastRoster()}
  send(ws,msg){if(ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify(msg))}
  broadcast(msg){const raw=JSON.stringify(msg);for(const ws of this.clients.values())if(ws.readyState===WebSocket.OPEN)ws.send(raw)}
  broadcastRoster(){this.broadcast({t:"roster",players:[...this.players.values()].map(p=>({id:p.id,wallet:p.wallet,username:p.username,profileImageUrl:p.profileImageUrl,color:p.color,glow:p.glow,connected:p.connected}))})}
  input(player,msg){if(!player.alive)return;const seq=Math.trunc(Number(msg.seq)||0);if(seq<=player.lastSeq)return;player.lastSeq=seq;player.input=normalizeInput(msg.x,msg.z);// Mobile means normalized onscreen-joystick input; the authority accepts planar input only.
    player.profile=msg.profile==="mobile"?"mobile":"desktop"}
  action(player){if(this.phase!=="live"||!player.alive||!player.body)return;const now=Date.now();if(player.powerKind&&now>=player.powerExpiresAt)this.clearPower(player);const kind=player.powerKind;if(!kind){this.normalJump(player);return}
    if(kind==="superjump"){
      if(this.grounded(player)){if(this.normalJump(player,1.18))player.doubleJumpArmed=true}
      else if(player.doubleJumpArmed){const v=player.body.linvel();player.body.setLinvel({x:v.x,y:this.config.jumpImpulse*1.42,z:v.z},true);player.doubleJumpArmed=false;this.clearPower(player);this.event("power",{playerId:player.id,powerKind:"superjump"})}
    } else if(kind==="blaster"){
      if(player.blasterActive)this.normalJump(player);else{player.blasterActive=true;player.nextShotAt=0;player.powerExpiresAt=now+this.config.weaponLifetimeMs;this.event("power",{playerId:player.id,powerKind:"blaster"})}
    } else if(kind==="superspeed"){
      if(now<player.speedUntil)this.normalJump(player);else{player.speedUntil=now+this.config.weaponLifetimeMs;player.powerExpiresAt=player.speedUntil;this.event("power",{playerId:player.id,powerKind:"superspeed"})}
    }
  }
  event(event,data){this.broadcast({t:"event",event,...data,at:Date.now()})}
  grounded(p){return Boolean(p.body)&&!p.airborne&&Math.abs(p.body.linvel().y)<.72}
  normalJump(p,mult=1){const now=Date.now();if(!p.body||now<p.jumpReadyAt||!this.grounded(p))return false;const v=p.body.linvel();p.body.setLinvel({x:v.x,y:this.config.jumpImpulse*mult,z:v.z},true);p.jumpReadyAt=now+this.config.jumpCooldownMs;p.airborne=true;p.descending=false;this.event("jump",{playerId:p.id});return true}
  clearPower(p){p.powerKind=null;p.powerExpiresAt=0;p.blasterActive=false;p.doubleJumpArmed=false}
  grantPower(p,kind,now){p.powerKind=kind;p.powerExpiresAt=now+this.config.weaponLifetimeMs;p.blasterActive=false;p.doubleJumpArmed=false;this.event("pickup",{playerId:p.id,powerKind:kind})}
  buildWorld(){
    const players=[...this.players.values()].filter(p=>p.connected);if(players.length<2){this.liveAt=Date.now()+3000;return false}
    // Remove entrants who never connected before the synchronized start. They can spectate later but cannot enter mid-match.
    for(const [wallet,p] of this.players)if(!p.connected)this.players.delete(wallet);
    this.config=configFor(this.players.size);const s=this.config.courseScale,world=new RAPIER.World({x:0,y:-GRAVITY,z:0});this.world=world;this.arenaHalf=30*s;
    const addSurface=(x,y,z,sx,sy,sz,ry=0,restitution=.045,friction=.58)=>{const body=world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x,y,z).setRotation(quat(0,ry,0)));world.createCollider(RAPIER.ColliderDesc.cuboid(sx/2,sy/2,sz/2).setFriction(friction).setRestitution(restitution),body)};
    const addRamp=(x,z,axis,dir,width=5*s,length=8*s,height=1.7*s)=>{const L=length,W=width,H=height,vertices=new Float32Array([-L/2,0,-W/2,-L/2,0,W/2,L/2,0,-W/2,L/2,0,W/2,L/2,H,-W/2,L/2,H,W/2]),ry=axis==="x"?(dir>0?0:Math.PI):(dir>0?-Math.PI/2:Math.PI/2),body=world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x,0,z).setRotation(quat(0,ry,0))),solid=RAPIER.ColliderDesc.convexHull(vertices);if(!solid)throw new Error("Could not build Arena ramp");world.createCollider(solid.setFriction(.62).setRestitution(.035),body)};
    addSurface(0,-.28,0,this.arenaHalf*2,.56,this.arenaHalf*2);
    const d=15.5*s;[[-d,0,"x",1],[d,0,"x",-1],[0,-d,"z",1],[0,d,"z",-1]].forEach(v=>addRamp(v[0],v[1],v[2],v[3],6.5*s,10*s,2.2*s));
    [[-11,-11,Math.PI/4],[11,-11,-Math.PI/4],[-11,11,-Math.PI/4],[11,11,Math.PI/4]].forEach(v=>addSurface(v[0]*s,.43,v[1]*s,10*s,.86,4*s,v[2]));
    addSurface(0,.28,0,16*s,.55,16*s);addSurface(0,.78,0,11.5*s,.55,11.5*s);addSurface(0,1.32,0,7.2*s,.55,7.2*s);
    const stepDepth=1.05*s,stepWidth=5.4*s;for(let side=0;side<4;side++)for(let i=0;i<4;i++){const top=.34+i*.28,offset=(8.4-i*1.05)*s,isNS=side<2,x=isNS?0:(side===2?-offset:offset),z=isNS?(side===0?-offset:offset):0;addSurface(x,top/2,z,isNS?stepWidth:stepDepth,top,isNS?stepDepth:stepWidth)}
    const wallR=this.arenaHalf*.965,wallSegments=48;for(let i=0;i<wallSegments;i++){const a=i/wallSegments*Math.PI*2,x=Math.cos(a)*wallR,z=Math.sin(a)*wallR,len=2*Math.PI*wallR/wallSegments*1.08;addSurface(x,1.9,z,len,4.2,1*s,Math.PI/2-a,.28,.48)}
    [[-9,-16],[9,-16],[-16,-9],[16,9],[-9,16],[9,16],[16,-9],[-16,9]].forEach(([xx,zz])=>{const body=world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(xx*s,1.05,zz*s));world.createCollider(RAPIER.ColliderDesc.cylinder(1.05,.72*s).setRestitution(.7).setFriction(.2),body)});
    const pedKinds=["superjump","blaster","superspeed","superjump","blaster","superspeed"],pedLoc=[[-14,-7],[14,-7],[-14,7],[14,7],[0,-15],[0,15]];this.pedestals=pedLoc.map(([xx,zz],i)=>{const x=xx*s,z=zz*s,body=world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x,.72,z));world.createCollider(RAPIER.ColliderDesc.cylinder(.72,1.75*s).setFriction(.52).setRestitution(.06),body);return{id:`ped-${i}`,x,z,kind:pedKinds[i],readyAt:0}});
    const addPickup=(id,rx,rz,y,kind)=>this.pickups.push({id,x:rx*s,z:rz*s,y:y+.16,kind,readyAt:0});this.pickups=[];
    addPickup("pick-sj-1",-21,-8,0,"superjump");addPickup("pick-sj-2",21,8,0,"superjump");addPickup("pick-bl-1",-8,-21,0,"blaster");addPickup("pick-bl-2",8,21,0,"blaster");addPickup("pick-sp-1",-20,14,0,"superspeed");addPickup("pick-sp-2",20,-14,0,"superspeed");addPickup("pick-hp-1",-16,-17,0,"recovery");addPickup("pick-hp-2",16,17,0,"recovery");addPickup("pick-sj-hi",-2.4,0,1.61,"superjump");addPickup("pick-bl-hi",2.4,0,1.61,"blaster");addPickup("pick-sp-hi",0,2.4,1.61,"superspeed");
    const list=[...this.players.values()];for(let i=0;i<list.length;i++){const p=list[i],a=Math.PI/4+i/list.length*Math.PI*2,spawnR=(i%2===0?23.5:21.5)*s,x=Math.cos(a)*spawnR,z=Math.sin(a)*spawnR,body=world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(x,1.05,z).setLinearDamping(LINEAR_DAMPING).setAngularDamping(ANGULAR_DAMPING).setCcdEnabled(true));world.createCollider(RAPIER.ColliderDesc.ball(BALL_RADIUS).setDensity(1).setFriction(FRICTION).setRestitution(.14),body);p.body=body;p.health=100;p.alive=true}
    this.phase="live";this.startedAt=Date.now();this.broadcastRoster();this.event("start",{startedAt:this.startedAt,courseScale:this.config.courseScale,playerCount:this.players.size});return true;
  }
  updatePlayers(now){for(const p of this.players.values()){if(!p.alive||!p.body)continue;const v=p.body.linvel(),speedMul=now<p.speedUntil?5:1,base=nextVelocity({x:v.x/speedMul,z:v.z/speedMul},p.input,p.profile),next={x:base.x*speedMul,z:base.z*speedMul};p.body.setLinvel({x:next.x,y:v.y,z:next.z},true)}}
  postStep(now){for(const p of this.players.values()){if(!p.alive||!p.body)continue;const v=p.body.linvel(),speedMul=now<p.speedUntil?5:1,base=clampVelocity({x:v.x/speedMul,z:v.z/speedMul},p.profile),cl={x:base.x*speedMul,z:base.z*speedMul};if(cl.x!==v.x||cl.z!==v.z)p.body.setLinvel({x:cl.x,y:v.y,z:cl.z},true);const pos=p.body.translation();if(p.airborne){if(v.y<-.25)p.descending=true;if(p.descending&&Math.abs(v.y)<.16){p.airborne=false;p.descending=false}}if(p.powerKind&&now>=p.powerExpiresAt)this.clearPower(p);if(pos.y<-5){p.body.setTranslation({x:clamp(pos.x,-this.arenaHalf*.7,this.arenaHalf*.7),y:2,z:clamp(pos.z,-this.arenaHalf*.7,this.arenaHalf*.7)},true);p.body.setLinvel({x:0,y:0,z:0},true);p.health=Math.max(1,p.health-4)}}}
  facing(p){const v=p.body.linvel(),speed=Math.hypot(v.x,v.z);if(speed>.55)return{x:v.x/speed,z:v.z/speed};const i=p.input,m=Math.hypot(i.x,i.z);return m>.1?{x:i.x/m,z:i.z/m}:{x:0,z:-1}}
  fire(p,now){const dir=this.facing(p),pos=p.body.translation();this.projectiles.push({id:`b${++this.seq}`,x:pos.x+dir.x*.95,y:pos.y+.06,z:pos.z+dir.z*.95,vx:dir.x*14,vz:dir.z*14,owner:p,born:now,life:1200});this.event("shot",{playerId:p.id})}
  updateProjectiles(now){for(const p of this.players.values())if(p.alive&&p.blasterActive&&p.powerKind==="blaster"&&now<p.powerExpiresAt&&now>=p.nextShotAt){this.fire(p,now);p.nextShotAt=now+145}
    for(let i=this.projectiles.length-1;i>=0;i--){const b=this.projectiles[i];if(now-b.born>b.life){this.projectiles.splice(i,1);continue}b.x+=b.vx*FIXED;b.z+=b.vz*FIXED;let hit=false;for(const t of this.players.values()){if(!t.alive||t===b.owner||!t.body)continue;const p=t.body.translation();if(Math.hypot(p.x-b.x,p.y-b.y,p.z-b.z)>BALL_RADIUS+.22*this.config.courseScale)continue;const inv=now<t.speedUntil,damage=inv?0:8,before=t.health;t.health=Math.max(0,t.health-damage);const actualDamage=before-t.health;if(actualDamage>0)b.owner.damageDealt+=actualDamage;if(!inv){const m=Math.hypot(b.vx,b.vz)||1;t.body.applyImpulse({x:b.vx/m*.75,y:.08,z:b.vz/m*.75},true)}this.event("hit",{playerId:t.id,attackerId:b.owner.id,attackKind:"blaster",damage});if(t.health<=0)this.eliminate(t,"BLASTED",b.owner);hit=true;break}if(hit)this.projectiles.splice(i,1)}
  }
  impacts(now){const list=[...this.players.values()].filter(p=>p.alive&&p.body);for(let i=0;i<list.length;i++)for(let j=i+1;j<list.length;j++){const a=list[i],b=list[j],pa=a.body.translation(),pb=b.body.translation(),nx=pb.x-pa.x,nz=pb.z-pa.z,dist=Math.hypot(nx,nz);if(dist>BALL_RADIUS*2.38||dist<.001)continue;const va=a.body.linvel(),vb=b.body.linvel(),ux=nx/dist,uz=nz/dist,closing=Math.max(0,-((vb.x-va.x)*ux+(vb.z-va.z)*uz)),key=`${a.id}:${b.id}`,last=this.pairHits.get(key)||0;if(closing<1.25||now-last<190)continue;this.pairHits.set(key,now);const sa=Math.hypot(va.x,va.z),sb=Math.hypot(vb.x,vb.z);let attacker=a,target=b;if(sb>sa){attacker=b;target=a}const speeding=now<attacker.speedUntil,targetInv=now<target.speedUntil,power=clamp((closing-1.1)/4.2,0,1);let damage=targetInv?0:clamp((closing-1.2)*this.config.impactDamageScale,0,4.2);if(speeding&&!targetInv)damage=clamp(18+power*12,18,30);const before=target.health;target.health=Math.max(0,target.health-damage);const actualDamage=before-target.health;if(actualDamage>0)attacker.damageDealt+=actualDamage;const direction=target===b?1:-1,knock=targetInv?.12:(.34+power*.72)*(speeding?2.2:1);if(!targetInv)target.body.applyImpulse({x:ux*direction*knock,y:.06+power*.2,z:uz*direction*knock},true);this.event("hit",{playerId:target.id,attackerId:attacker.id,attackKind:speeding?"superspeed":"impact",damage});if(target.health<=0)this.eliminate(target,"SHATTERED",attacker)}}
  pickupsTick(now){const elapsed=(now-this.startedAt)/1000,respawn=elapsed>=this.config.overchargeAt?.38:elapsed>=this.config.suddenDeathAt?.58:1,s=this.config.courseScale;for(const pick of this.pickups){if(now<pick.readyAt)continue;for(const p of this.players.values()){if(!p.alive||!p.body)continue;const pos=p.body.translation();if(Math.hypot(pos.x-pick.x,pos.z-pick.z)>1.5*s||Math.abs(pos.y-pick.y)>2.4)continue;pick.readyAt=now+this.config.ringRespawnMs*respawn;if(pick.kind==="recovery"){const before=p.health;p.health=Math.min(100,p.health+this.config.recoveryAmount);this.event("recover",{playerId:p.id,amount:p.health-before})}else this.grantPower(p,pick.kind,now);break}}
    for(const ped of this.pedestals){if(now<ped.readyAt)continue;for(const p of this.players.values()){if(!p.alive||!p.body||p.powerKind)continue;const pos=p.body.translation();if(Math.hypot(pos.x-ped.x,pos.z-ped.z)>1.55*s||pos.y<1.35)continue;ped.readyAt=now+this.config.pedestalRespawnMs*respawn;this.grantPower(p,ped.kind,now);break}}
  }
  abort(reason){if(this.phase==="finished"||this.phase==="aborted")return;this.phase="aborted";this.completedAt=Date.now();this.abortReason=reason;this.broadcast({t:"aborted",reason,completedAt:this.completedAt});}
  eliminate(p,reason,attacker=null){if(!p.alive)return;p.alive=false;if(attacker&&attacker!==p)attacker.knockouts=(attacker.knockouts||0)+1;if(p.body)p.body.setEnabled(false);this.event("eliminated",{playerId:p.id,reason,attackerId:attacker?.id||null});this.maybeFinish()}
  maybeFinish(){const alive=[...this.players.values()].filter(p=>p.alive);if(this.phase!=="live"||alive.length>1)return;if(alive.length===1)this.finish(alive[0]);else this.finish(null)}
  finish(winner){if(this.phase==="finished")return;this.phase="finished";this.completedAt=Date.now();this.winner=winner||null;this.broadcast({t:"finished",winnerId:winner?.id||null,completedAt:this.completedAt});if(winner)void this.postResult(winner)}
  async postResult(winner){if(this.resultPosted||this.resultPosting)return;this.resultPosting=true;const body=JSON.stringify({schemaVersion:1,version:VERSION,matchId:this.matchId,orbId:this.orbId,slug:this.slug,startedAt:this.startedAt,completedAt:this.completedAt,participantCount:this.players.size,commitment:this.commitment,winnerWallet:winner.wallet,winnerXUserId:winner.xUserId,winnerUsername:winner.username});const ts=String(Date.now()),sig=createHmac("sha256",HMAC_KEY).update(`${ts}.${body}`,"utf8").digest("base64url");try{const r=await fetch(`${SITE_URL}/api/arena/runtime/result`,{method:"POST",headers:{"content-type":"application/json","x-arena-timestamp":ts,"x-arena-signature":sig},body});if(!r.ok)throw new Error(`result callback ${r.status}: ${await r.text()}`);this.resultPosted=true}catch(e){console.error("[arena] winner callback failed",e);this.resultRetryTimer=setTimeout(()=>{this.resultRetryTimer=null;this.resultPosting=false;void this.postResult(winner)},3000);return}this.resultPosting=false}
  tick(){const now=Date.now();if(this.phase==="lobby"){if(now>this.startsAt+LOBBY_CLOSE_MS){this.abort("Arena could not start with at least two connected entrants in the launch window");return}if(now>=this.liveAt)this.buildWorld();if(now-this.lastSnapshot>=SNAPSHOT_MS){this.lastSnapshot=now;this.broadcast({t:"lobby",phase:this.phase,liveAt:this.liveAt,connected:[...this.players.values()].filter(p=>p.connected).length})}return}if(this.phase!=="live")return;
    for(const p of this.players.values())if(p.alive&&!p.connected&&p.disconnectedAt&&now-p.disconnectedAt>=DISCONNECT_GRACE_MS)this.eliminate(p,"CONNECTION LOST");
    if(this.phase!=="live")return;
    this.updatePlayers(now);this.world.step();this.impacts(now);this.updateProjectiles(now);this.pickupsTick(now);this.postStep(now);const elapsed=now-this.startedAt;if(elapsed>=HARD_CAP_MS){const alive=[...this.players.values()].filter(p=>p.alive).sort((a,b)=>(b.knockouts||0)-(a.knockouts||0)||(b.damageDealt||0)-(a.damageDealt||0)||b.health-a.health);if(alive.length>1){const a=alive[0],b=alive[1],exactTie=(a.knockouts||0)===(b.knockouts||0)&&Math.abs((a.damageDealt||0)-(b.damageDealt||0))<.001&&Math.abs(a.health-b.health)<.001;if(exactTie){this.abort("Arena ended in an exact sudden-death tie; no winner was recorded");return}for(const p of alive.slice(1))this.eliminate(p,"SUDDEN DEATH",a)}this.maybeFinish()}if(now-this.lastSnapshot>=SNAPSHOT_MS){this.lastSnapshot=now;this.snapshot(now)}}
  snapshot(now){this.broadcast({t:"snapshot",phase:this.phase,matchId:this.matchId,startedAt:this.startedAt,serverNow:now,maxSeconds:this.config.maxSeconds,courseScale:this.config.courseScale,players:[...this.players.values()].map(p=>{const pos=p.body?.translation(),q=p.body?.rotation(),v=p.body?.linvel();return{id:p.id,p:pos?[pos.x,pos.y,pos.z]:null,q:q?[q.x,q.y,q.z,q.w]:null,v:v?[v.x,v.y,v.z]:null,h:Math.round(p.health),ko:p.knockouts||0,dmg:Math.round((p.damageDealt||0)*10)/10,alive:p.alive,power:p.powerKind,exp:p.powerExpiresAt,speed:p.speedUntil}}),projectiles:this.projectiles.map(b=>({id:b.id,p:[b.x,b.y,b.z]})),pickups:this.pickups.map(p=>({id:p.id,ready:now>=p.readyAt})),pedestals:this.pedestals.map(p=>({id:p.id,ready:now>=p.readyAt}))})}
  close(){clearInterval(this.timer);if(this.resultRetryTimer)clearTimeout(this.resultRetryTimer);for(const ws of this.clients.values())try{ws.close()}catch{}}
}

const rooms=new Map();
const server=http.createServer((req,res)=>{if(req.url==="/health"){const roomList=[...rooms.values()];res.writeHead(200,{"content-type":"application/json","cache-control":"no-store"});res.end(JSON.stringify({ok:true,version:VERSION,rooms:roomList.length,liveRooms:roomList.filter(r=>r.phase==="live").length,lobbyRooms:roomList.filter(r=>r.phase==="lobby").length}));return}res.writeHead(404);res.end("Not found")});
const wss=new WebSocketServer({noServer:true,maxPayload:16*1024});
server.on("upgrade",(req,socket,head)=>{try{const url=new URL(req.url||"/",`http://${req.headers.host||"localhost"}`);if(url.pathname!=="/arena")throw new Error("Not found");const origin=String(req.headers.origin||"");if(origin!==SITE_ORIGIN)throw new Error("Forbidden origin");wss.handleUpgrade(req,socket,head,ws=>wss.emit("connection",ws,req))}catch{socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");socket.destroy()}});
wss.on("connection",ws=>{
  ws.isAlive=true;ws.on("pong",()=>{ws.isAlive=true});
  let room=null;let authed=false;let windowStarted=Date.now(),messageCount=0,actionCount=0,strikes=0;const authTimer=setTimeout(()=>{if(!authed)ws.close(1008,"Arena authentication timeout")},5000);
  ws.on("message",raw=>{
    const now=Date.now();if(now-windowStarted>=1000){windowStarted=now;messageCount=0;actionCount=0}messageCount++;if(messageCount>MAX_MESSAGES_PER_SECOND){strikes++;if(strikes>=3)ws.close(1008,"Arena input rate exceeded");return}
    if(raw.length>8192)return;const msg=safeJson(raw.toString());if(!msg)return;
    if(!authed){if(msg.t!=="auth")return;const p=verifyToken(msg.token);if(!p){ws.close(1008,"Invalid Arena token");return}room=rooms.get(p.orbId);if(!room){if(Date.now()>p.startsAt+120_000){ws.close(1008,"Arena start window closed");return}room=new Room(p);rooms.set(p.orbId,room)}try{room.add(ws,p)}catch(e){ws.close(1008,e instanceof Error?e.message:"Arena rejected");return}authed=true;clearTimeout(authTimer);return}
    if(!ws.player||!room)return;if(msg.t==="input")room.input(ws.player,msg);else if(msg.t==="action"){actionCount++;if(actionCount<=MAX_ACTIONS_PER_SECOND)room.action(ws.player)}else if(msg.t==="ping")room.send(ws,{t:"pong",at:Date.now()});
  });
  ws.on("close",()=>{clearTimeout(authTimer);room?.remove(ws)});ws.on("error",()=>{clearTimeout(authTimer);room?.remove(ws)});
});
setInterval(()=>{for(const ws of wss.clients){if(ws.isAlive===false){try{ws.terminate()}catch{};continue}ws.isAlive=false;try{ws.ping()}catch{}}},HEARTBEAT_MS).unref();
setInterval(()=>{const now=Date.now();for(const [id,room] of rooms){if(now>room.endsAt+60_000||(room.phase==="finished"||room.phase==="aborted")&&now-room.completedAt>120_000){room.close();rooms.delete(id)}}},30_000).unref();
server.listen(PORT,"0.0.0.0",()=>console.log(`[arena] ${VERSION} authoritative server listening on :${PORT}`));
