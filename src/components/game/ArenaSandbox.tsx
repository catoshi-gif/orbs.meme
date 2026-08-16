"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArenaAudioEngine } from "@/game/arenaAudio";
import { arenaRadiusAt, buildArenaConfig, type ArenaPace } from "@/game/arena";
import { clampPlanarSpeed, nextPlanarVelocity } from "@/game/simulation";
import { PHYSICS } from "@/game/constants";
import type { GameStyle } from "@/game/types";

type Props = {
  playerCount: number;
  style: GameStyle;
  seed: string;
  pace: ArenaPace;
  generation: number;
};

type Phase = "ready" | "countdown" | "playing" | "eliminated" | "won" | "finished";
type ControlMode = "keys" | "touch" | "sensor";

type OrbSim = {
  id: string;
  username: string;
  color: string;
  secondary: string;
  body: import("@dimforge/rapier3d-compat").RigidBody;
  mesh: import("three").Mesh;
  label: import("three").Sprite;
  alive: boolean;
  isHuman: boolean;
  bumpReadyAt: number;
  botHeading: number;
  botThinkAt: number;
};

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
const usernames = [
  "orbitaljup","bonkpilot","madlad","solsurfer","pixelwhale","caturday","degenqueen","mooncrate","zerogravity","mintghost",
  "blockrunner","jupcat","helioroll","voidwalker","tokenpunk","lamportlord","orbmaxi","driftmode","neonape","cryptokite",
  "glasscanon","solanaut","rollhard","bagholder","mevless","chainchaser","memeengine","jupiterian","vaultfox","orbitron",
];

function seeded(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return () => {
    h += h << 13; h ^= h >>> 7; h += h << 3; h ^= h >>> 17; h += h << 5;
    return (h >>> 0) / 4294967296;
  };
}

function orbColor(index: number, rand: () => number) {
  const hue = (index * 137.508 + rand() * 38) % 360;
  return `hsl(${hue.toFixed(0)} 88% 61%)`;
}

function makeLabel(THREE: typeof import("three"), text: string, tint: string) {
  const canvas = document.createElement("canvas");
  canvas.width = 512; canvas.height = 128;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.font = "800 48px Arial";
  const width = Math.min(470, ctx.measureText(text).width + 62);
  ctx.fillStyle = "rgba(3,7,18,.78)";
  ctx.strokeStyle = "rgba(255,255,255,.24)";
  ctx.lineWidth = 3;
  const x = (512 - width) / 2;
  ctx.beginPath();
  ctx.roundRect(x, 20, width, 76, 30);
  ctx.fill(); ctx.stroke();
  ctx.fillStyle = tint;
  ctx.beginPath(); ctx.arc(x + 30, 58, 9, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "white";
  ctx.textAlign = "center";
  ctx.fillText(text, 256, 74);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(3.15, 0.79, 1);
  sprite.position.set(0, 1.12, 0);
  return sprite;
}

function makeOrbMaterial(THREE: typeof import("three"), primary: string, secondary: string, accent: string) {
  return new THREE.MeshPhysicalMaterial({
    color: primary,
    emissive: new THREE.Color(secondary).multiplyScalar(0.28),
    emissiveIntensity: 0.9,
    roughness: 0.12,
    metalness: 0.1,
    transmission: 0.28,
    thickness: 1.1,
    clearcoat: 1,
    clearcoatRoughness: 0.08,
    iridescence: 0.35,
    iridescenceIOR: 1.6,
  });
}

export default function ArenaSandbox({ playerCount, style, seed, pace, generation }: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const controlsRef = useRef({ up: false, down: false, left: false, right: false, touchX: 0, touchY: 0 });
  const sensorRef = useRef({ active: false, beta: 0, gamma: 0, neutralBeta: 0, neutralGamma: 0 });
  const bumpRef = useRef<() => void>(() => undefined);
  const startRef = useRef<() => void>(() => undefined);
  const [phase, setPhase] = useState<Phase>("ready");
  const [countdown, setCountdown] = useState(0);
  const [survivors, setSurvivors] = useState(playerCount);
  const [elapsed, setElapsed] = useState(0);
  const [controlMode, setControlMode] = useState<ControlMode>("keys");
  const controlModeRef = useRef<ControlMode>("keys");
  const [sensorAvailable, setSensorAvailable] = useState(false);
  const [bumpCooldown, setBumpCooldown] = useState(0);
  const [winner, setWinner] = useState<string | null>(null);
  const [eventText, setEventText] = useState("LAST ORB STANDING");
  const config = useMemo(() => buildArenaConfig({ playerCount, pace, style, seed }), [playerCount, pace, style, seed]);

  const requestMotion = useCallback(async () => {
    const DeviceOrientationEventAny = window.DeviceOrientationEvent as typeof DeviceOrientationEvent & { requestPermission?: () => Promise<"granted" | "denied"> };
    try {
      if (typeof DeviceOrientationEventAny.requestPermission === "function") {
        const result = await DeviceOrientationEventAny.requestPermission();
        if (result !== "granted") return;
      }
      sensorRef.current.neutralBeta = sensorRef.current.beta;
      sensorRef.current.neutralGamma = sensorRef.current.gamma;
      sensorRef.current.active = true;
      controlModeRef.current = "sensor"; setControlMode("sensor");
    } catch { /* touch remains available */ }
  }, []);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    let cancelled = false;
    let frame = 0;
    let resizeObserver: ResizeObserver | null = null;
    let cleanupThree: (() => void) | null = null;
    const audio = new ArenaAudioEngine();

    setPhase("ready"); setSurvivors(playerCount); setElapsed(0); setWinner(null); setEventText("LAST ORB STANDING"); setBumpCooldown(0);

    const orientation = (event: DeviceOrientationEvent) => {
      sensorRef.current.beta = event.beta ?? 0;
      sensorRef.current.gamma = event.gamma ?? 0;
    };
    window.addEventListener("deviceorientation", orientation);
    if ("DeviceOrientationEvent" in window) setSensorAvailable(true);
    if (window.matchMedia("(pointer: coarse)").matches) { controlModeRef.current = "touch"; setControlMode("touch"); }

    const onKey = (event: KeyboardEvent, down: boolean) => {
      if (["ArrowUp","ArrowDown","ArrowLeft","ArrowRight","KeyW","KeyA","KeyS","KeyD","Space"].includes(event.code)) event.preventDefault();
      if (event.code === "ArrowUp" || event.code === "KeyW") controlsRef.current.up = down;
      if (event.code === "ArrowDown" || event.code === "KeyS") controlsRef.current.down = down;
      if (event.code === "ArrowLeft" || event.code === "KeyA") controlsRef.current.left = down;
      if (event.code === "ArrowRight" || event.code === "KeyD") controlsRef.current.right = down;
      if (event.code === "Space" && down && !event.repeat) bumpRef.current();
    };
    const kd = (e: KeyboardEvent) => onKey(e, true);
    const ku = (e: KeyboardEvent) => onKey(e, false);
    window.addEventListener("keydown", kd, { passive: false });
    window.addEventListener("keyup", ku, { passive: false });

    (async () => {
      const THREE = await import("three");
      const RAPIER = await import("@dimforge/rapier3d-compat");
      await RAPIER.init();
      if (cancelled) return;

      const scene = new THREE.Scene();
      scene.background = new THREE.Color("#030612");
      scene.fog = new THREE.FogExp2(style.floor, 0.018);
      const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 300);
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.15;
      renderer.shadowMap.enabled = true;
      mount.innerHTML = "";
      mount.appendChild(renderer.domElement);

      const ambient = new THREE.HemisphereLight(style.marbleSecondary, "#050818", 1.65);
      scene.add(ambient);
      const sun = new THREE.DirectionalLight("#ffffff", 3.2);
      sun.position.set(-10, 18, 7); sun.castShadow = true; scene.add(sun);
      const rim = new THREE.PointLight(style.accent, 85, 60, 2); rim.position.set(0, 10, -10); scene.add(rim);

      const stars = new THREE.BufferGeometry();
      const starPos: number[] = [];
      const rand = seeded(`${seed}:${generation}`);
      for (let i = 0; i < 700; i += 1) {
        const a = rand() * Math.PI * 2, r = 35 + rand() * 110, y = 4 + rand() * 55;
        starPos.push(Math.cos(a) * r, y, Math.sin(a) * r);
      }
      stars.setAttribute("position", new THREE.Float32BufferAttribute(starPos, 3));
      scene.add(new THREE.Points(stars, new THREE.PointsMaterial({ color: "#b8d8ff", size: 0.13, transparent: true, opacity: 0.75 })));

      const world = new RAPIER.World({ x: 0, y: -PHYSICS.gravity, z: 0 });
      const floorBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.18, 0));
      world.createCollider(RAPIER.ColliderDesc.cylinder(0.18, config.radius).setFriction(PHYSICS.friction).setRestitution(PHYSICS.restitution), floorBody);

      const floorGeo = new THREE.CylinderGeometry(config.radius, config.radius * 1.025, 0.36, 96, 1, false);
      const floorMat = new THREE.MeshPhysicalMaterial({ color: style.floor, emissive: new THREE.Color(style.accent).multiplyScalar(0.12), roughness: 0.28, metalness: 0.48, transmission: 0.2, clearcoat: 1 });
      const floorMesh = new THREE.Mesh(floorGeo, floorMat); floorMesh.position.y = -0.18; floorMesh.receiveShadow = true; scene.add(floorMesh);
      const rings: import("three").Mesh[] = [];
      for (let i = 0; i < 6; i += 1) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(config.radius * (0.24 + i * 0.145), 0.035, 8, 120), new THREE.MeshBasicMaterial({ color: i % 2 ? style.marbleSecondary : style.accent, transparent: true, opacity: 0.42 }));
        ring.rotation.x = Math.PI / 2; ring.position.y = 0.025; scene.add(ring); rings.push(ring);
      }
      const boundary = new THREE.Mesh(new THREE.TorusGeometry(config.radius, 0.09, 10, 160), new THREE.MeshBasicMaterial({ color: style.accent, transparent: true, opacity: 0.9 }));
      boundary.rotation.x = Math.PI / 2; boundary.position.y = 0.06; scene.add(boundary);

      const sweeperGroup = new THREE.Group();
      const sweeper = new THREE.Mesh(new THREE.BoxGeometry(config.radius * 1.3, 0.28, 0.22), new THREE.MeshStandardMaterial({ color: style.walls, emissive: style.accent, emissiveIntensity: 0.6, roughness: 0.22 }));
      sweeper.position.x = config.radius * 0.33; sweeper.position.y = 0.36; sweeper.castShadow = true; sweeperGroup.add(sweeper); scene.add(sweeperGroup);
      const sweeperBody = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(config.radius * 0.33, 0.36, 0));
      world.createCollider(RAPIER.ColliderDesc.cuboid(config.radius * 0.65, 0.14, 0.11).setFriction(0.1).setRestitution(0.95), sweeperBody);

      const orbGeo = new THREE.SphereGeometry(PHYSICS.ballRadius, 32, 22);
      const orbs: OrbSim[] = [];
      const spawnRadius = Math.max(2.8, config.radius * 0.72);
      for (let i = 0; i < playerCount; i += 1) {
        const isHuman = i === 0;
        const a = (i / playerCount) * Math.PI * 2 + rand() * 0.08;
        const r = spawnRadius * (0.82 + rand() * 0.17);
        const primary = isHuman ? style.marble : orbColor(i, rand);
        const secondary = isHuman ? style.marbleSecondary : orbColor(i + 53, rand);
        const mesh = new THREE.Mesh(orbGeo, makeOrbMaterial(THREE, primary, secondary, style.accent));
        mesh.castShadow = true;
        mesh.position.set(Math.cos(a) * r, PHYSICS.ballRadius + 0.03, Math.sin(a) * r);
        const username = isHuman ? "@you" : `@${usernames[(i - 1) % usernames.length]}${i > usernames.length ? String(i) : ""}`;
        const label = makeLabel(THREE, username, primary); mesh.add(label); scene.add(mesh);
        const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(mesh.position.x, mesh.position.y, mesh.position.z).setLinearDamping(PHYSICS.linearDamping).setAngularDamping(PHYSICS.angularDamping).setCcdEnabled(true));
        world.createCollider(RAPIER.ColliderDesc.ball(PHYSICS.ballRadius).setDensity(1).setFriction(PHYSICS.friction).setRestitution(0.23), body);
        orbs.push({ id: `orb-${i}`, username, color: primary, secondary, body, mesh, label, alive: true, isHuman, bumpReadyAt: 0, botHeading: rand() * Math.PI * 2, botThinkAt: 0 });
      }
      const human = orbs[0]!;

      let live = false;
      let startAt = 0;
      let simTime = 0;
      let last = performance.now() / 1000;
      let accumulator = 0;
      let activeRadius = config.radius;
      let lastPulse = -999;
      let pulseTarget: OrbSim | null = null;
      let pulseAt = 0;
      let lastUiUpdate = 0;
      let resolved = false;

      const eliminate = (orb: OrbSim, reason = "fell into the void") => {
        if (!orb.alive) return;
        orb.alive = false;
        orb.mesh.visible = false;
        orb.body.setEnabled(false);
        const alive = orbs.filter(o => o.alive);
        setSurvivors(alive.length);
        if (orb.isHuman) { setPhase("eliminated"); setEventText("YOU'RE OUT · SPECTATING"); audio.eliminated(); }
        else if (alive.length > 1) setEventText(`${orb.username} ${reason.toUpperCase()}`);
        if (alive.length === 1 && !resolved) {
          resolved = true; live = false;
          const winnerOrb = alive[0]!;
          setWinner(winnerOrb.username);
          setEventText(`${winnerOrb.username} WINS`);
          setPhase(winnerOrb.isHuman ? "won" : "finished");
          audio.victory();
        }
      };

      const doBump = (orb: OrbSim, nowMs: number) => {
        if (!live || !orb.alive || nowMs < orb.bumpReadyAt) return;
        const v = orb.body.linvel();
        let dx = v.x, dz = v.z;
        const mag = Math.hypot(dx, dz);
        if (mag < 0.25) {
          const p = orb.body.translation(); const towardCenter = Math.atan2(-p.z, -p.x);
          dx = Math.cos(towardCenter); dz = Math.sin(towardCenter);
        } else { dx /= mag; dz /= mag; }
        orb.body.applyImpulse({ x: dx * config.bumpImpulse, y: 0.16, z: dz * config.bumpImpulse }, true);
        orb.bumpReadyAt = nowMs + config.bumpCooldownMs;
        if (orb.isHuman) { setBumpCooldown(1); audio.bump(); }
      };
      bumpRef.current = () => doBump(human, performance.now());

      const begin = () => {
        if (live || resolved) return;
        let n = 3; setCountdown(n); setPhase("countdown");
        const timer = window.setInterval(() => {
          n -= 1; setCountdown(n);
          if (n <= 0) {
            window.clearInterval(timer); live = true; startAt = performance.now() / 1000; setPhase("playing"); setEventText(`${playerCount} ORBS ENTER`); audio.startMusic();
          }
        }, 650);
      };
      startRef.current = begin;

      const resize = () => {
        const rect = mount.getBoundingClientRect(); if (!rect.width || !rect.height) return;
        renderer.setSize(rect.width, rect.height, false); camera.aspect = rect.width / rect.height; camera.updateProjectionMatrix();
      };
      resizeObserver = new ResizeObserver(resize); resizeObserver.observe(mount); resize();

      const updateCamera = () => {
        const survivorsNow = orbs.filter(o => o.alive);
        let targetX = 0, targetZ = 0;
        if (human.alive) { const p = human.body.translation(); targetX = p.x * 0.18; targetZ = p.z * 0.18; }
        else if (survivorsNow.length) { const p = survivorsNow[0]!.body.translation(); targetX = p.x * 0.12; targetZ = p.z * 0.12; }
        const dist = Math.max(15, activeRadius * 1.48);
        camera.position.lerp(new THREE.Vector3(targetX, dist * 0.92, targetZ + dist * 0.66), 0.045);
        camera.lookAt(targetX, 0, targetZ);
      };

      const render = (ms: number) => {
        frame = requestAnimationFrame(render);
        const now = ms / 1000;
        const dt = clamp(now - last, 0, 0.05); last = now; accumulator = Math.min(accumulator + dt, PHYSICS.fixedStep * 5);
        if (live) {
          const matchElapsed = now - startAt;
          activeRadius = arenaRadiusAt(config, matchElapsed, orbs.filter(o => o.alive).length);
          const scale = activeRadius / config.radius;
          floorMesh.scale.set(scale, 1, scale); boundary.scale.setScalar(scale);
          rings.forEach((ring, i) => { const local = Math.min(1, scale / (0.24 + i * 0.145)); ring.visible = local > 0.86; });
          const intensity = clamp(Math.max(matchElapsed / config.maxSeconds, 1 - orbs.filter(o => o.alive).length / playerCount), 0, 1);
          audio.setIntensity(intensity);
          if (matchElapsed > config.suddenDeathAt && Math.floor(matchElapsed) % 6 === 0) setEventText("SUDDEN DEATH");

          if (matchElapsed > config.suddenDeathAt && matchElapsed - lastPulse >= config.voidPulseInterval) {
            const candidates = orbs.filter(o => o.alive).sort((a,b) => {
              const pa = a.body.translation(), pb = b.body.translation();
              return Math.hypot(pb.x,pb.z)-Math.hypot(pa.x,pa.z);
            });
            pulseTarget = candidates[0] ?? null; pulseAt = matchElapsed; lastPulse = matchElapsed;
            if (pulseTarget) setEventText(`VOID PULSE · ${pulseTarget.username}`);
          }
          if (pulseTarget && pulseTarget.alive && matchElapsed - pulseAt > 1.35) {
            const p = pulseTarget.body.translation(); const mag = Math.max(0.1, Math.hypot(p.x,p.z));
            pulseTarget.body.applyImpulse({ x: (p.x/mag)*5.2, y: 1.4, z: (p.z/mag)*5.2 }, true);
            pulseTarget = null;
          }

          while (accumulator >= PHYSICS.fixedStep) {
            simTime += PHYSICS.fixedStep;
            const angle = simTime * (0.3 + intensity * 0.75);
            sweeperGroup.rotation.y = angle;
            sweeperBody.setNextKinematicTranslation({ x: Math.cos(angle) * config.radius * 0.33, y: 0.36, z: -Math.sin(angle) * config.radius * 0.33 });
            const half = -angle / 2;
            sweeperBody.setNextKinematicRotation({ x: 0, y: Math.sin(half), z: 0, w: Math.cos(half) });

            for (const orb of orbs) {
              if (!orb.alive) continue;
              let inputX = 0, inputY = 0;
              if (orb.isHuman) {
                const keys = controlsRef.current;
                inputX = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
                inputY = (keys.up ? 1 : 0) - (keys.down ? 1 : 0);
                if (controlModeRef.current === "touch") { inputX = keys.touchX; inputY = keys.touchY; }
                if (sensorRef.current.active && controlModeRef.current === "sensor") {
                  inputX = clamp((sensorRef.current.gamma - sensorRef.current.neutralGamma) / PHYSICS.sensorFullScaleDeg, -1, 1);
                  inputY = clamp(-(sensorRef.current.beta - sensorRef.current.neutralBeta) / PHYSICS.sensorFullScaleDeg, -1, 1);
                }
              } else {
                const p = orb.body.translation();
                if (simTime >= orb.botThinkAt) {
                  const enemies = orbs.filter(o => o.alive && o !== orb);
                  const target = enemies[Math.floor(rand() * Math.max(1, enemies.length))];
                  const edgeDanger = Math.hypot(p.x,p.z) > activeRadius * 0.72;
                  if (edgeDanger) orb.botHeading = Math.atan2(-p.z, -p.x) + (rand()-0.5)*0.45;
                  else if (target && rand() > 0.25) { const tp = target.body.translation(); orb.botHeading = Math.atan2(tp.z-p.z, tp.x-p.x) + (rand()-0.5)*0.42; }
                  else orb.botHeading += (rand()-0.5)*1.8;
                  orb.botThinkAt = simTime + 0.25 + rand()*0.45;
                  if (target && rand() < 0.18) doBump(orb, performance.now());
                }
                inputX = Math.cos(orb.botHeading); inputY = -Math.sin(orb.botHeading);
              }
              const v = orb.body.linvel();
              const steered = nextPlanarVelocity({ x: v.x, z: v.z }, inputX, inputY, orb.isHuman && controlModeRef.current === "keys" ? "desktop" : "mobile");
              orb.body.setLinvel({ x: steered.x, y: v.y, z: steered.z }, true);
            }
            world.step();
            for (const orb of orbs) {
              if (!orb.alive) continue;
              const v = orb.body.linvel();
              const clamped = clampPlanarSpeed({ x: v.x, z: v.z }, orb.isHuman && controlModeRef.current === "keys" ? "desktop" : "mobile");
              if (clamped.x !== v.x || clamped.z !== v.z) orb.body.setLinvel({ x: clamped.x, y: v.y, z: clamped.z }, true);
              const p = orb.body.translation();
              if (p.y < -1.5 || Math.hypot(p.x,p.z) > activeRadius + PHYSICS.ballRadius * 0.58) eliminate(orb);
            }
            if (!resolved && matchElapsed >= config.maxSeconds) {
              const alive = orbs.filter(o => o.alive).sort((a,b) => {
                const pa=a.body.translation(), pb=b.body.translation(); return Math.hypot(pa.x,pa.z)-Math.hypot(pb.x,pb.z);
              });
              alive.slice(1).forEach(o => eliminate(o, "lost the final collapse"));
            }
            accumulator -= PHYSICS.fixedStep;
          }

          if (now - lastUiUpdate > 0.1) {
            lastUiUpdate = now; setElapsed(matchElapsed);
            if (human.bumpReadyAt > performance.now()) setBumpCooldown(clamp((human.bumpReadyAt-performance.now())/config.bumpCooldownMs,0,1)); else setBumpCooldown(0);
          }
        }

        orbs.forEach(orb => {
          if (!orb.alive) return;
          const p = orb.body.translation(), q = orb.body.rotation();
          orb.mesh.position.set(p.x,p.y,p.z); orb.mesh.quaternion.set(q.x,q.y,q.z,q.w);
          orb.label.quaternion.copy(camera.quaternion);
        });
        if (pulseTarget?.alive) {
          const pulse = 1 + Math.sin(ms * 0.018) * 0.22;
          pulseTarget.mesh.scale.setScalar(pulse);
        }
        orbs.forEach(o => { if (o !== pulseTarget) o.mesh.scale.setScalar(1); });
        const aliveForGlow = orbs.filter(o => o.alive).length;
        floorMat.emissiveIntensity = 0.08 + Math.sin(ms*0.0018)*0.025 + (live ? Math.max(0,1-aliveForGlow/playerCount)*0.15 : 0);
        updateCamera(); renderer.render(scene,camera);
      };
      render(performance.now());

      cleanupThree = () => {
        cancelAnimationFrame(frame); resizeObserver?.disconnect();
        orbs.forEach(o => { (o.mesh.material as import("three").Material).dispose(); (o.label.material as import("three").Material).dispose(); });
        orbGeo.dispose(); floorGeo.dispose(); floorMat.dispose(); renderer.dispose(); mount.innerHTML = "";
      };
    })();

    return () => {
      cancelled = true; cleanupThree?.(); audio.stop(); window.removeEventListener("deviceorientation", orientation); window.removeEventListener("keydown", kd); window.removeEventListener("keyup", ku);
    };
  }, [config, generation, playerCount, seed, style]);

  const touchStart = useCallback((event: React.PointerEvent<HTMLDivElement>) => { event.currentTarget.setPointerCapture(event.pointerId); }, []);
  const touchMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const r = event.currentTarget.getBoundingClientRect(); const x=(event.clientX-(r.left+r.width/2))/(r.width*.36); const y=(event.clientY-(r.top+r.height/2))/(r.height*.36);
    const mag=Math.max(1,Math.hypot(x,y)); controlsRef.current.touchX=clamp(x/mag,-1,1); controlsRef.current.touchY=clamp(-y/mag,-1,1);
  }, []);
  const touchEnd = useCallback((event: React.PointerEvent<HTMLDivElement>) => { controlsRef.current.touchX=0; controlsRef.current.touchY=0; try{event.currentTarget.releasePointerCapture(event.pointerId);}catch{} }, []);

  const timeLeft = Math.max(0, config.maxSeconds - elapsed);
  return <div className="arena-sandbox-game">
    <div ref={mountRef} className="arena-sandbox-canvas" />
    <div className="arena-hud arena-hud-top">
      <div><span>ORBS REMAIN</span><strong>{survivors}</strong></div>
      <div className="arena-event"><strong>{eventText}</strong><small>{Math.floor(timeLeft/60)}:{String(Math.floor(timeLeft%60)).padStart(2,"0")} · radius {arenaRadiusAt(config,elapsed,survivors).toFixed(1)}m</small></div>
      <div><span>PLAYERS</span><strong>{playerCount}</strong></div>
    </div>
    {phase === "ready" ? <div className="arena-center-card"><span>ADMIN ARENA DEMO</span><h3>LAST ORB STANDING</h3><p>Arrow keys / WASD to roll. Space to BUMP. Stay on the shrinking floor.</p><button className="btn-primary" onClick={()=>startRef.current()}>Enter Arena →</button></div> : null}
    {phase === "countdown" ? <div className="arena-countdown">{countdown || "GO"}</div> : null}
    {(phase === "eliminated" || phase === "finished" || phase === "won") ? <div className="arena-result-card"><span>{phase === "eliminated" ? "SPECTATING" : "MATCH COMPLETE"}</span><h3>{phase === "won" ? "YOU WIN" : winner ? `${winner} WINS` : "YOU'RE OUT"}</h3><p>{phase === "eliminated" ? `${survivors} Orbs remain. The camera stays live until one survives.` : "Last Orb standing takes the prize."}</p></div> : null}
    {(phase === "playing" || phase === "eliminated") ? <div className="arena-bump-wrap"><button className="arena-bump" onClick={()=>bumpRef.current()} disabled={phase === "eliminated" || bumpCooldown>0.02}><span>BUMP</span><i style={{transform:`scaleX(${1-bumpCooldown})`}} /></button></div> : null}
    {(phase === "playing" || phase === "eliminated") && controlMode === "touch" ? <div className="game-touch-pad arena-touch" onPointerDown={touchStart} onPointerMove={touchMove} onPointerUp={touchEnd} onPointerCancel={touchEnd}><div className="game-touch-knob" /></div> : null}
    {sensorAvailable && phase === "playing" ? <div className="arena-controls"><button onClick={()=>void requestMotion()}>{controlMode === "sensor" ? "Tilt active" : "Enable tilt"}</button>{controlMode === "sensor"?<button onClick={()=>{controlModeRef.current="touch";setControlMode("touch")}}>Touch control</button>:null}</div> : null}
  </div>;
}
