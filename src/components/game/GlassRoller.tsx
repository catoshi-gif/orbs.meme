"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PHYSICS } from "@/game/constants";
import { generateGameManifest } from "@/game/maze";
import type { DifficultyKey, GameStyle } from "@/game/types";

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
const rad = (deg: number) => (deg * Math.PI) / 180;
const formatTime = (seconds: number) => {
  const min = Math.floor(seconds / 60);
  const sec = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);
  return `${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")}.${String(ms).padStart(3, "0")}`;
};

type Props = {
  slug: string;
  difficulty: DifficultyKey;
  style: GameStyle;
};

type Phase = "loading" | "ready" | "countdown" | "playing" | "won";
type ControlMode = "keys" | "sensor" | "touch";

type ReplayPoint = { tick: number; pitch: number; roll: number };

function makeMountainRing(THREE: typeof import("three"), radius: number, seed: number, y: number, color: string) {
  const segments = 64;
  const positions: number[] = [];
  const rand = (n: number) => {
    const x = Math.sin((seed + n * 19.17) * 12.9898) * 43758.5453;
    return x - Math.floor(x);
  };
  for (let i = 0; i < segments; i += 1) {
    const a0 = (i / segments) * Math.PI * 2;
    const a1 = ((i + 1) / segments) * Math.PI * 2;
    const h0 = 1.2 + rand(i) * 5.4 + Math.pow(rand(i + 177), 4) * 7;
    const h1 = 1.2 + rand(i + 1) * 5.4 + Math.pow(rand(i + 178), 4) * 7;
    const inner = radius * 0.94;
    positions.push(
      Math.cos(a0) * inner, y, Math.sin(a0) * inner,
      Math.cos(a0) * radius, y + h0, Math.sin(a0) * radius,
      Math.cos(a1) * radius, y + h1, Math.sin(a1) * radius,
      Math.cos(a0) * inner, y, Math.sin(a0) * inner,
      Math.cos(a1) * radius, y + h1, Math.sin(a1) * radius,
      Math.cos(a1) * inner, y, Math.sin(a1) * inner,
    );
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  const material = new THREE.MeshStandardMaterial({ color, roughness: 0.92, metalness: 0.08, side: THREE.DoubleSide });
  return new THREE.Mesh(geometry, material);
}

function makeSky(THREE: typeof import("three"), accent: string) {
  const geometry = new THREE.SphereGeometry(82, 40, 24);
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      uAccent: { value: new THREE.Color(accent) },
    },
    vertexShader: `
      varying vec3 vDir;
      void main(){
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);
      }
    `,
    fragmentShader: `
      varying vec3 vDir;
      uniform vec3 uAccent;
      void main(){
        float horizon = pow(1.0 - abs(vDir.y), 6.0);
        float zenith = smoothstep(-0.15, 0.9, vDir.y);
        float aurora = smoothstep(0.72, 1.0, sin(vDir.x*8.0 + vDir.z*10.0 + vDir.y*4.0)*0.5+0.5) * horizon;
        vec3 deep = vec3(0.008,0.018,0.08);
        vec3 mid = vec3(0.035,0.07,0.22);
        vec3 color = mix(mid, deep, zenith);
        color += uAccent * horizon * 0.42;
        color += vec3(0.04,0.75,0.95) * aurora * 0.22;
        gl_FragColor = vec4(color,1.0);
      }
    `,
  });
  return new THREE.Mesh(geometry, material);
}

function makeMarbleMaterial(THREE: typeof import("three"), primary: string, secondary: string, accent: string) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: true,
    uniforms: {
      uTime: { value: 0 },
      uPrimary: { value: new THREE.Color(primary) },
      uSecondary: { value: new THREE.Color(secondary) },
      uAccent: { value: new THREE.Color(accent) },
    },
    vertexShader: `
      varying vec3 vObj;
      varying vec3 vNormalW;
      varying vec3 vWorld;
      void main(){
        vObj = position;
        vNormalW = normalize(mat3(modelMatrix) * normal);
        vec4 world = modelMatrix * vec4(position,1.0);
        vWorld = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: `
      precision highp float;
      uniform float uTime;
      uniform vec3 uPrimary;
      uniform vec3 uSecondary;
      uniform vec3 uAccent;
      varying vec3 vObj;
      varying vec3 vNormalW;
      varying vec3 vWorld;
      void main(){
        vec3 n = normalize(vNormalW);
        vec3 viewDir = normalize(cameraPosition - vWorld);
        float fresnel = pow(1.0 - max(dot(n, viewDir), 0.0), 2.15);

        float flowA = sin(vObj.x * 3.0 + vObj.z * 2.25 + sin(vObj.y * 3.6 + uTime * 0.22) * 0.8 + uTime * 0.14);
        float flowB = sin(vObj.y * 4.1 - vObj.x * 2.05 + vObj.z * 1.4 - uTime * 0.11);
        float nebula = clamp(0.5 + flowA * 0.16 + flowB * 0.11, 0.0, 1.0);

        float innerGlow = 0.55 + 0.45 * max(0.0, dot(normalize(vObj + vec3(-0.24,0.42,0.18)), normalize(vec3(-0.4,0.65,0.4))));
        vec3 glass = mix(uPrimary * 0.42, uSecondary * 0.82, nebula);
        glass += uAccent * (0.08 + nebula * 0.12);
        glass *= 0.72 + innerGlow * 0.38;

        float broadHighlight = pow(max(dot(n, normalize(vec3(-0.38,0.82,0.38))), 0.0), 10.0);
        vec3 rim = mix(uSecondary, uAccent, 0.42) * fresnel * 1.35;
        vec3 color = glass + rim + vec3(1.0) * broadHighlight * 0.68;
        color += uSecondary * pow(fresnel, 4.0) * 0.38;

        float alpha = 0.94 + fresnel * 0.05;
        gl_FragColor = vec4(color, alpha);
      }
    `,
  });
}

function makeFloorMaterial(THREE: typeof import("three"), floor: string, secondary: string, accent: string) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: {
      uTime: { value: 0 },
      uFloor: { value: new THREE.Color(floor) },
      uSecondary: { value: new THREE.Color(secondary) },
      uAccent: { value: new THREE.Color(accent) },
    },
    vertexShader: `
      varying vec2 vUv;
      varying vec3 vWorld;
      varying vec3 vNormalW;
      void main(){
        vUv = uv;
        vec4 world = modelMatrix * vec4(position,1.0);
        vWorld = world.xyz;
        vNormalW = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: `
      precision highp float;
      varying vec2 vUv;
      varying vec3 vWorld;
      varying vec3 vNormalW;
      uniform float uTime;
      uniform vec3 uFloor;
      uniform vec3 uSecondary;
      uniform vec3 uAccent;

      void main(){
        vec2 p = vUv - 0.5;
        vec3 viewDir = normalize(cameraPosition - vWorld);
        float fresnel = pow(1.0 - max(dot(normalize(vNormalW), viewDir), 0.0), 2.0);

        float waveA = sin(vUv.x * 11.0 + vUv.y * 7.0 + uTime * 0.32);
        float waveB = sin(vUv.y * 14.0 - vUv.x * 5.0 - uTime * 0.24);
        float waveC = sin((vUv.x + vUv.y) * 18.0 + uTime * 0.16);
        float crystal = 0.5 + 0.5 * sin(waveA * 1.4 + waveB * 1.15 + waveC * 0.55);
        float vein = smoothstep(0.76, 0.98, crystal) * 0.34;
        float centerGlow = 1.0 - smoothstep(0.08, 0.76, length(p));

        vec3 base = uFloor * 0.34;
        base += uSecondary * (0.07 + crystal * 0.10);
        base += uAccent * (0.05 + vein * 0.42 + centerGlow * 0.06);
        base += mix(uSecondary, vec3(1.0), 0.22) * fresnel * 0.24;

        float alpha = 0.38 + crystal * 0.08 + fresnel * 0.10;
        gl_FragColor = vec4(base, alpha);
      }
    `,
  });
}

export default function GlassRoller({ slug, difficulty, style }: Props) {
  const manifest = useMemo(() => generateGameManifest(slug, difficulty, style), [slug, difficulty, style]);
  const mountRef = useRef<HTMLDivElement>(null);
  const phaseRef = useRef<Phase>("loading");
  const controlsRef = useRef({ up: false, down: false, left: false, right: false, touchX: 0, touchY: 0 });
  const sensorRef = useRef({ active: false, neutralBeta: 0, neutralGamma: 0, beta: 0, gamma: 0 });
  const resetRef = useRef<(() => void) | null>(null);
  const startRef = useRef<(() => void) | null>(null);
  const cameraReturnRef = useRef<(() => void) | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [controlMode, setControlModeState] = useState<ControlMode>("keys");
  const controlModeRef = useRef<ControlMode>("keys");
  const setControlMode = useCallback((mode: ControlMode) => { controlModeRef.current = mode; setControlModeState(mode); }, []);
  const [countdown, setCountdown] = useState(3);
  const [elapsed, setElapsed] = useState(0);
  const [speed, setSpeed] = useState(0);
  const [checkpoint, setCheckpoint] = useState(0);
  const [resets, setResets] = useState(0);
  const [sensorAvailable, setSensorAvailable] = useState(false);
  const [sensorMessage, setSensorMessage] = useState<string | null>(null);
  const [loadingLabel, setLoadingLabel] = useState("Warming the glass world…");

  useEffect(() => {
    setSensorAvailable(typeof window !== "undefined" && "DeviceOrientationEvent" in window);
    if (window.matchMedia("(pointer: coarse)").matches) setControlMode("touch");
  }, [setControlMode]);

  const changePhase = useCallback((next: Phase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  const requestMotion = useCallback(async () => {
    if (!("DeviceOrientationEvent" in window)) {
      setControlMode("touch");
      setSensorMessage("Motion sensors are unavailable here. Touch tilt is ready instead.");
      return;
    }
    try {
      const orientation = DeviceOrientationEvent as typeof DeviceOrientationEvent & { requestPermission?: () => Promise<"granted" | "denied"> };
      if (typeof orientation.requestPermission === "function") {
        const result = await orientation.requestPermission();
        if (result !== "granted") throw new Error("Motion permission denied");
      }
      sensorRef.current.active = true;
      sensorRef.current.neutralBeta = sensorRef.current.beta;
      sensorRef.current.neutralGamma = sensorRef.current.gamma;
      setControlMode("sensor");
      setSensorMessage("Device tilt calibrated. Hold the phone naturally and roll.");
    } catch {
      sensorRef.current.active = false;
      setControlMode("touch");
      setSensorMessage("Motion permission was not granted. Touch tilt is enabled.");
    }
  }, []);

  const recalibrate = useCallback(() => {
    sensorRef.current.neutralBeta = sensorRef.current.beta;
    sensorRef.current.neutralGamma = sensorRef.current.gamma;
    setSensorMessage("Tilt center recalibrated.");
  }, []);

  useEffect(() => {
    const onOrientation = (event: DeviceOrientationEvent) => {
      sensorRef.current.beta = event.beta ?? 0;
      sensorRef.current.gamma = event.gamma ?? 0;
    };
    window.addEventListener("deviceorientation", onOrientation, true);
    return () => window.removeEventListener("deviceorientation", onOrientation, true);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent, down: boolean) => {
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "KeyW", "KeyA", "KeyS", "KeyD", "KeyR", "Space"].includes(event.code)) {
        event.preventDefault();
      }
      if (event.code === "ArrowUp" || event.code === "KeyW") controlsRef.current.up = down;
      if (event.code === "ArrowDown" || event.code === "KeyS") controlsRef.current.down = down;
      if (event.code === "ArrowLeft" || event.code === "KeyA") controlsRef.current.left = down;
      if (event.code === "ArrowRight" || event.code === "KeyD") controlsRef.current.right = down;
      if (down && ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "KeyW", "KeyA", "KeyS", "KeyD"].includes(event.code)) cameraReturnRef.current?.();
      if (down && event.code === "KeyR") resetRef.current?.();
      if (down && event.code === "Space" && phaseRef.current === "ready") startRef.current?.();
    };
    const kd = (e: KeyboardEvent) => onKey(e, true);
    const ku = (e: KeyboardEvent) => onKey(e, false);
    const clearControls = () => {
      controlsRef.current.up = false;
      controlsRef.current.down = false;
      controlsRef.current.left = false;
      controlsRef.current.right = false;
      controlsRef.current.touchX = 0;
      controlsRef.current.touchY = 0;
    };
    window.addEventListener("keydown", kd, { passive: false });
    window.addEventListener("keyup", ku, { passive: false });
    window.addEventListener("blur", clearControls);
    document.addEventListener("visibilitychange", clearControls);
    return () => {
      window.removeEventListener("keydown", kd);
      window.removeEventListener("keyup", ku);
      window.removeEventListener("blur", clearControls);
      document.removeEventListener("visibilitychange", clearControls);
    };
  }, []);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    changePhase("loading");
    setElapsed(0);
    setSpeed(0);
    setCheckpoint(0);
    setResets(0);
    let cancelled = false;
    let frame = 0;
    let resizeObserver: ResizeObserver | null = null;
    let disposeEngine: (() => void) | null = null;

    (async () => {
      setLoadingLabel("Loading deterministic physics…");
      const [THREE, rapierModule] = await Promise.all([import("three"), import("@dimforge/rapier3d-compat")]);
      const RAPIER = rapierModule.default;
      await RAPIER.init();
      if (cancelled) return;
      setLoadingLabel("Forging your maze…");

      const liftColor = (hex: string, minLightness: number) => {
        const color = new THREE.Color(hex);
        const hsl = { h: 0, s: 0, l: 0 };
        color.getHSL(hsl);
        if (hsl.l < minLightness) color.setHSL(hsl.h, Math.max(hsl.s, 0.45), minLightness);
        return color;
      };
      const displayWall = liftColor(style.walls, 0.48);
      const displayAccent = liftColor(style.accent, 0.5);
      const displayMarbleSecondary = liftColor(style.marbleSecondary, 0.5);
      const displayFloor = new THREE.Color(style.floor).lerp(new THREE.Color("#050817"), 0.46);
      const wallHex = `#${displayWall.getHexString()}`;
      const accentHex = `#${displayAccent.getHexString()}`;
      const marbleSecondaryHex = `#${displayMarbleSecondary.getHexString()}`;
      const floorHex = `#${displayFloor.getHexString()}`;

      const scene = new THREE.Scene();
      scene.background = new THREE.Color("#050817");
      scene.fog = new THREE.FogExp2("#080D25", 0.012);

      const camera = new THREE.PerspectiveCamera(48, 1, 0.08, 130);
      camera.position.set(manifest.start.x, 5.2, manifest.start.z + 6.4);
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.05;
      const mobileish = window.matchMedia("(pointer: coarse)").matches || window.innerWidth < 800;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, mobileish ? 1.25 : 1.5));
      renderer.domElement.className = "glass-roller-canvas";
      mount.appendChild(renderer.domElement);
      let currentDpr = Math.min(window.devicePixelRatio || 1, mobileish ? 1.25 : 1.5);
      let frameBudgetSamples = 0;
      let frameBudgetTotal = 0;

      const hemi = new THREE.HemisphereLight("#8CF6FF", "#07091B", 2.1);
      scene.add(hemi);
      const key = new THREE.DirectionalLight("#A7DBFF", 3.2);
      key.position.set(-12, 20, 9);
      scene.add(key);
      const rim = new THREE.DirectionalLight(accentHex, 2.5);
      rim.position.set(12, 7, -14);
      scene.add(rim);

      const sky = makeSky(THREE, accentHex);
      scene.add(sky);
      const mountainsA = makeMountainRing(THREE, 45, manifest.seed, -2.2, "#10183C");
      const mountainsB = makeMountainRing(THREE, 54, manifest.seed + 991, -2.4, "#09112B");
      scene.add(mountainsA, mountainsB);

      const starGeometry = new THREE.BufferGeometry();
      const stars = new Float32Array(720 * 3);
      let starSeed = manifest.seed || 1;
      const starRand = () => {
        starSeed ^= starSeed << 13;
        starSeed ^= starSeed >>> 17;
        starSeed ^= starSeed << 5;
        return ((starSeed >>> 0) % 100000) / 100000;
      };
      for (let i = 0; i < 720; i += 1) {
        const theta = starRand() * Math.PI * 2;
        const y = 4 + starRand() * 42;
        const radius = 38 + starRand() * 34;
        stars[i * 3] = Math.cos(theta) * radius;
        stars[i * 3 + 1] = y;
        stars[i * 3 + 2] = Math.sin(theta) * radius;
      }
      starGeometry.setAttribute("position", new THREE.BufferAttribute(stars, 3));
      const starMaterial = new THREE.PointsMaterial({ color: "#CBE8FF", size: 0.09, transparent: true, opacity: 0.8, sizeAttenuation: true });
      scene.add(new THREE.Points(starGeometry, starMaterial));

      const boardGroup = new THREE.Group();
      scene.add(boardGroup);

      const floorGeometry = new THREE.PlaneGeometry(manifest.width, manifest.depth, 1, 1);
      const floorMaterial = makeFloorMaterial(THREE, floorHex, marbleSecondaryHex, accentHex);
      const floor = new THREE.Mesh(floorGeometry, floorMaterial);
      floor.rotation.x = -Math.PI / 2;
      floor.position.y = -0.005;
      floor.renderOrder = 1;
      boardGroup.add(floor);

      // A faint luminous membrane under the transparent crystal floor keeps the board readable
      // without hiding the mountain world beneath it.
      const floorGlow = new THREE.Mesh(
        new THREE.PlaneGeometry(manifest.width * 1.006, manifest.depth * 1.006),
        new THREE.MeshBasicMaterial({ color: accentHex, transparent: true, opacity: 0.035, blending: THREE.AdditiveBlending, depthWrite: false }),
      );
      floorGlow.rotation.x = -Math.PI / 2;
      floorGlow.position.y = -0.035;
      floorGlow.renderOrder = 0;
      boardGroup.add(floorGlow);

      const wallGeometry = new THREE.BoxGeometry(1, 1, 1);
      const wallMaterial = new THREE.MeshStandardMaterial({
        color: wallHex,
        emissive: displayWall.clone().multiplyScalar(0.24),
        emissiveIntensity: 1,
        transparent: true,
        opacity: 0.43,
        roughness: 0.13,
        metalness: 0.12,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const wallMesh = new THREE.InstancedMesh(wallGeometry, wallMaterial, manifest.walls.length);
      wallMesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
      wallMesh.renderOrder = 2;

      // The body remains a single instanced box draw-call, but every pane overlaps slightly and
      // receives a rounded luminous rail. This hides cell seams and makes the walls read as
      // continuous framed crystal instead of stacked voxel boxes.
      const railGeometry = new THREE.CylinderGeometry(1, 1, 1, 10, 1, false);
      const railMaterial = new THREE.MeshBasicMaterial({ color: wallHex, transparent: true, opacity: 0.88, blending: THREE.AdditiveBlending, depthWrite: false });
      const railMesh = new THREE.InstancedMesh(railGeometry, railMaterial, manifest.walls.length);
      railMesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
      railMesh.renderOrder = 3;

      const endpointMap = new Map<string, { x: number; z: number }>();
      for (const wall of manifest.walls) {
        if (wall.axis === "x") {
          endpointMap.set(`${(wall.x - wall.length / 2).toFixed(4)}:${wall.z.toFixed(4)}`, { x: wall.x - wall.length / 2, z: wall.z });
          endpointMap.set(`${(wall.x + wall.length / 2).toFixed(4)}:${wall.z.toFixed(4)}`, { x: wall.x + wall.length / 2, z: wall.z });
        } else {
          endpointMap.set(`${wall.x.toFixed(4)}:${(wall.z - wall.length / 2).toFixed(4)}`, { x: wall.x, z: wall.z - wall.length / 2 });
          endpointMap.set(`${wall.x.toFixed(4)}:${(wall.z + wall.length / 2).toFixed(4)}`, { x: wall.x, z: wall.z + wall.length / 2 });
        }
      }
      const postMesh = new THREE.InstancedMesh(railGeometry, railMaterial, endpointMap.size);
      postMesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
      postMesh.renderOrder = 3;

      const matrix = new THREE.Matrix4();
      const quat = new THREE.Quaternion();
      const quatX = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);
      const quatZ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
      const scale = new THREE.Vector3();
      const pos = new THREE.Vector3();
      const visualOverlap = PHYSICS.wallThickness * 0.92;
      const railRadius = PHYSICS.wallThickness * 0.47;
      manifest.walls.forEach((wall, i) => {
        const visualLength = wall.length + visualOverlap;
        pos.set(wall.x, PHYSICS.wallHeight / 2, wall.z);
        scale.set(wall.axis === "x" ? visualLength : PHYSICS.wallThickness, PHYSICS.wallHeight, wall.axis === "z" ? visualLength : PHYSICS.wallThickness);
        matrix.compose(pos, quat, scale);
        wallMesh.setMatrixAt(i, matrix);

        pos.set(wall.x, PHYSICS.wallHeight + 0.018, wall.z);
        scale.set(railRadius, visualLength, railRadius);
        matrix.compose(pos, wall.axis === "x" ? quatX : quatZ, scale);
        railMesh.setMatrixAt(i, matrix);
      });
      let postIndex = 0;
      endpointMap.forEach((endpoint) => {
        pos.set(endpoint.x, PHYSICS.wallHeight / 2, endpoint.z);
        scale.set(railRadius, PHYSICS.wallHeight + 0.07, railRadius);
        matrix.compose(pos, quat, scale);
        postMesh.setMatrixAt(postIndex, matrix);
        postIndex += 1;
      });
      wallMesh.instanceMatrix.needsUpdate = true;
      railMesh.instanceMatrix.needsUpdate = true;
      postMesh.instanceMatrix.needsUpdate = true;
      boardGroup.add(wallMesh, railMesh, postMesh);

      const goalGroup = new THREE.Group();
      goalGroup.position.set(manifest.goal.x, 0.035, manifest.goal.z);
      const goalDisc = new THREE.Mesh(
        new THREE.CircleGeometry(0.78, 48),
        new THREE.MeshBasicMaterial({ color: accentHex, transparent: true, opacity: 0.28, blending: THREE.AdditiveBlending, depthWrite: false }),
      );
      goalDisc.rotation.x = -Math.PI / 2;
      goalGroup.add(goalDisc);
      const goalRing = new THREE.Mesh(
        new THREE.TorusGeometry(0.72, 0.07, 12, 48),
        new THREE.MeshBasicMaterial({ color: marbleSecondaryHex, transparent: true, opacity: 0.95 }),
      );
      goalRing.rotation.x = Math.PI / 2;
      goalGroup.add(goalRing);
      const goalBeam = new THREE.Mesh(
        new THREE.CylinderGeometry(0.2, 0.72, 2.8, 24, 1, true),
        new THREE.MeshBasicMaterial({ color: accentHex, transparent: true, opacity: 0.075, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
      );
      goalBeam.position.y = 1.38;
      goalGroup.add(goalBeam);
      boardGroup.add(goalGroup);

      const checkpointGroups = manifest.checkpoints.map((cp, idx) => {
        const g = new THREE.Group();
        g.position.set(cp.x, 0.024, cp.z);
        const ring = new THREE.Mesh(
          new THREE.RingGeometry(0.48, 0.57, 40),
          new THREE.MeshBasicMaterial({ color: idx === 0 ? marbleSecondaryHex : accentHex, transparent: true, opacity: 0.34, side: THREE.DoubleSide }),
        );
        ring.rotation.x = -Math.PI / 2;
        g.add(ring);
        boardGroup.add(g);
        return g;
      });

      const gateBarGeometry = new THREE.CylinderGeometry(0.11, 0.11, 1, 12, 1, false);
      const gateHubGeometry = new THREE.SphereGeometry(0.16, 14, 10);
      const gateMaterial = new THREE.MeshStandardMaterial({ color: accentHex, emissive: accentHex, emissiveIntensity: 0.7, metalness: 0.48, roughness: 0.12 });
      const gateMeshes = manifest.gates.map((gate) => {
        const group = new THREE.Group();
        const bar = new THREE.Mesh(gateBarGeometry, gateMaterial);
        bar.rotation.z = Math.PI / 2;
        bar.scale.y = gate.length;
        const hub = new THREE.Mesh(gateHubGeometry, gateMaterial);
        group.add(bar, hub);
        group.position.set(gate.x, 0.34, gate.z);
        boardGroup.add(group);
        return group;
      });

      const bumperGeometry = new THREE.CylinderGeometry(1, 1, 0.56, 20);
      const bumperMaterial = new THREE.MeshStandardMaterial({
        color: marbleSecondaryHex,
        emissive: marbleSecondaryHex,
        emissiveIntensity: 0.42,
        metalness: 0.48,
        roughness: 0.16,
      });
      const bumperMesh = new THREE.InstancedMesh(bumperGeometry, bumperMaterial, manifest.bumpers.length);
      manifest.bumpers.forEach((bumper, i) => {
        pos.set(bumper.x, 0.28, bumper.z);
        scale.set(bumper.radius, 1, bumper.radius);
        matrix.compose(pos, quat, scale);
        bumperMesh.setMatrixAt(i, matrix);
      });
      bumperMesh.instanceMatrix.needsUpdate = true;
      boardGroup.add(bumperMesh);

      const marbleMaterial = makeMarbleMaterial(THREE, style.marble, marbleSecondaryHex, accentHex);
      const marbleGroup = new THREE.Group();
      marbleGroup.position.set(manifest.start.x, PHYSICS.ballRadius + 0.04, manifest.start.z);
      const marbleMesh = new THREE.Mesh(new THREE.SphereGeometry(PHYSICS.ballRadius, 44, 30), marbleMaterial);
      marbleMesh.renderOrder = 5;
      const marbleCore = new THREE.Mesh(
        new THREE.SphereGeometry(PHYSICS.ballRadius * 0.78, 28, 20),
        new THREE.MeshBasicMaterial({ color: marbleSecondaryHex, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false }),
      );
      marbleCore.scale.set(0.92, 1.04, 0.92);
      marbleCore.renderOrder = 5;
      marbleGroup.add(marbleMesh, marbleCore);
      boardGroup.add(marbleGroup);
      const shadowMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(PHYSICS.ballRadius * 2.35, PHYSICS.ballRadius * 2.35),
        new THREE.ShaderMaterial({
          transparent: true,
          depthWrite: false,
          uniforms: { uGlow: { value: new THREE.Color(marbleSecondaryHex) } },
          vertexShader: `varying vec2 vUv; void main(){vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
          fragmentShader: `varying vec2 vUv; uniform vec3 uGlow; void main(){ float d=length(vUv-0.5)*2.0; float a=(1.0-smoothstep(0.08,1.0,d)); vec3 c=mix(vec3(0.0),uGlow,0.12); gl_FragColor=vec4(c,a*0.24); }`,
        }),
      );
      shadowMesh.rotation.x = -Math.PI / 2;
      shadowMesh.position.y = 0.012;
      shadowMesh.renderOrder = 4;
      boardGroup.add(shadowMesh);

      const world = new RAPIER.World({ x: 0, y: -PHYSICS.gravity, z: 0 });
      world.timestep = PHYSICS.fixedStep;
      const floorCollider = RAPIER.ColliderDesc.cuboid(manifest.width / 2, PHYSICS.floorThickness / 2, manifest.depth / 2)
        .setTranslation(0, -PHYSICS.floorThickness / 2, 0)
        .setFriction(PHYSICS.friction)
        .setRestitution(0.02);
      world.createCollider(floorCollider);
      for (const wall of manifest.walls) {
        const hx = wall.axis === "x" ? wall.length / 2 : PHYSICS.wallThickness / 2;
        const hz = wall.axis === "z" ? wall.length / 2 : PHYSICS.wallThickness / 2;
        world.createCollider(
          RAPIER.ColliderDesc.cuboid(hx, PHYSICS.wallHeight / 2, hz)
            .setTranslation(wall.x, PHYSICS.wallHeight / 2, wall.z)
            .setFriction(0.3)
            .setRestitution(0.05),
        );
      }
      for (const bumper of manifest.bumpers) {
        world.createCollider(
          RAPIER.ColliderDesc.cylinder(0.28, bumper.radius)
            .setTranslation(bumper.x, 0.28, bumper.z)
            .setFriction(0.28)
            .setRestitution(0.16),
        );
      }

      const ballBody = world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(manifest.start.x, PHYSICS.ballRadius + 0.06, manifest.start.z)
          .setLinearDamping(PHYSICS.linearDamping)
          .setAngularDamping(PHYSICS.angularDamping)
          .setCanSleep(false)
          .setCcdEnabled(true),
      );
      world.createCollider(
        RAPIER.ColliderDesc.ball(PHYSICS.ballRadius)
          .setDensity(1.15)
          .setFriction(PHYSICS.friction)
          .setRestitution(PHYSICS.restitution),
        ballBody,
      );

      const gateBodies = manifest.gates.map((gate) => {
        const body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(gate.x, 0.32, gate.z));
        world.createCollider(RAPIER.ColliderDesc.cuboid(gate.length / 2, 0.23, 0.08).setFriction(0.3).setRestitution(0.04), body);
        return body;
      });

      let currentPitch = 0;
      let currentRoll = 0;
      let accumulator = 0;
      let last = performance.now() / 1000;
      let simTime = 0;
      let startTime = 0;
      let nextHudAt = 0;
      let physicsTick = 0;
      let sampledInputX = 0;
      let sampledInputY = 0;
      let nextCheckpoint = 0;
      let lastSafe = { ...manifest.start };
      let resetCount = 0;
      let runStartTick = 0;
      const replay: ReplayPoint[] = [];
      const localBall = new THREE.Vector3();
      const cameraLocal = new THREE.Vector3();
      const cameraWorld = new THREE.Vector3();
      const followCameraWorld = new THREE.Vector3();
      const overviewCameraWorld = new THREE.Vector3();
      const lookLocal = new THREE.Vector3();
      const lookWorld = new THREE.Vector3();
      const followLookWorld = new THREE.Vector3();
      const overviewLookWorld = new THREE.Vector3();
      const boardQuat = new THREE.Quaternion();
      const inverseBoardQuat = new THREE.Quaternion();
      const gravityVec = new THREE.Vector3();
      const velocityVec = new THREE.Vector3();
      const euler = new THREE.Euler();
      const boardExtent = Math.max(manifest.width, manifest.depth);
      let overviewTarget = 0;
      let overviewMix = 0;
      let cameraDragActive = false;
      let cameraDragStartY = 0;
      let cameraDragStartTarget = 0;

      const returnToFollowCamera = () => { overviewTarget = 0; };
      cameraReturnRef.current = returnToFollowCamera;

      const onCameraPointerDown = (event: PointerEvent) => {
        if (mobileish || event.button !== 0) return;
        cameraDragActive = true;
        cameraDragStartY = event.clientY;
        cameraDragStartTarget = overviewTarget;
        renderer.domElement.setPointerCapture?.(event.pointerId);
        renderer.domElement.classList.add("camera-dragging");
      };
      const onCameraPointerMove = (event: PointerEvent) => {
        if (!cameraDragActive || mobileish) return;
        const drag = (event.clientY - cameraDragStartY) / 190;
        overviewTarget = clamp(cameraDragStartTarget + drag, 0, 1);
      };
      const onCameraPointerUp = (event: PointerEvent) => {
        if (!cameraDragActive) return;
        cameraDragActive = false;
        if (renderer.domElement.hasPointerCapture?.(event.pointerId)) renderer.domElement.releasePointerCapture?.(event.pointerId);
        renderer.domElement.classList.remove("camera-dragging");
      };
      if (!mobileish) {
        renderer.domElement.addEventListener("pointerdown", onCameraPointerDown);
        renderer.domElement.addEventListener("pointermove", onCameraPointerMove);
        renderer.domElement.addEventListener("pointerup", onCameraPointerUp);
        renderer.domElement.addEventListener("pointercancel", onCameraPointerUp);
      }

      const resetBall = () => {
        ballBody.setTranslation({ x: lastSafe.x, y: PHYSICS.ballRadius + 0.08, z: lastSafe.z }, true);
        ballBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
        ballBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
        resetCount += 1;
        setResets(resetCount);
      };
      resetRef.current = resetBall;

      const begin = () => {
        if (phaseRef.current !== "ready") return;
        changePhase("countdown");
        setCountdown(3);
        let remaining = 3;
        const countdownTimer = window.setInterval(() => {
          remaining -= 1;
          if (remaining <= 0) {
            window.clearInterval(countdownTimer);
            setCountdown(0);
            startTime = performance.now() / 1000;
            runStartTick = physicsTick;
            replay.length = 0;
            changePhase("playing");
          } else {
            setCountdown(remaining);
          }
        }, 700);
      };
      startRef.current = begin;

      const resize = () => {
        const rect = mount.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        renderer.setSize(rect.width, rect.height, false);
        camera.aspect = rect.width / rect.height;
        camera.updateProjectionMatrix();
      };
      resizeObserver = new ResizeObserver(resize);
      resizeObserver.observe(mount);
      resize();

      changePhase("ready");
      setLoadingLabel("Ready");

      const renderFrame = (nowMs: number) => {
        frame = requestAnimationFrame(renderFrame);
        const now = nowMs / 1000;
        let dt = clamp(now - last, 0, 0.05);
        last = now;
        accumulator = Math.min(accumulator + dt, PHYSICS.fixedStep * 4);

        if (phaseRef.current === "playing") {
          while (accumulator >= PHYSICS.fixedStep) {
            const maxTilt = rad(manifest.profile.maxTiltDeg);
            if (physicsTick % 3 === 0) {
              const keys = controlsRef.current;
              let inputX = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
              let inputY = (keys.up ? 1 : 0) - (keys.down ? 1 : 0);

              if (sensorRef.current.active && controlModeRef.current === "sensor") {
                const gammaDelta = sensorRef.current.gamma - sensorRef.current.neutralGamma;
                const betaDelta = sensorRef.current.beta - sensorRef.current.neutralBeta;
                const legacyAngle = (window as Window & { orientation?: number }).orientation;
                const angleDegrees = window.screen.orientation?.angle ?? (typeof legacyAngle === "number" ? legacyAngle : 0);
                const screenAngle = (angleDegrees * Math.PI) / 180;
                const portraitX = gammaDelta;
                const portraitY = -betaDelta;
                const rotatedX = portraitX * Math.cos(screenAngle) + portraitY * Math.sin(screenAngle);
                const rotatedY = -portraitX * Math.sin(screenAngle) + portraitY * Math.cos(screenAngle);
                inputX = clamp(rotatedX / 18, -1, 1);
                inputY = clamp(rotatedY / 18, -1, 1);
              } else if (controlModeRef.current === "touch") {
                inputX = keys.touchX;
                inputY = keys.touchY;
              }

              const quantizedX = Math.round(clamp(inputX, -1, 1) * 127);
              const quantizedY = Math.round(clamp(inputY, -1, 1) * 127);
              sampledInputX = quantizedX / 127;
              sampledInputY = quantizedY / 127;
              replay.push({ tick: physicsTick - runStartTick, pitch: quantizedY, roll: quantizedX });
            }

            const directDesktop = controlModeRef.current === "keys";
            const alpha = 1 - Math.exp(-PHYSICS.fixedStep / PHYSICS.tiltSmoothSeconds);
            if (directDesktop) {
              // Desktop is intentionally easier and more arcade-readable: arrows/WASD apply
              // a bounded physical force to the marble while the board stays level. The ball
              // still accelerates, collides and rolls through Rapier; we never teleport it.
              currentPitch += (0 - currentPitch) * alpha;
              currentRoll += (0 - currentRoll) * alpha;
              boardQuat.identity();
              world.gravity.x = 0;
              world.gravity.y = -PHYSICS.gravity;
              world.gravity.z = 0;
              ballBody.setLinearDamping(PHYSICS.desktopLinearDamping);

              const inputMagnitude = Math.hypot(sampledInputX, sampledInputY);
              if (inputMagnitude > 0.001) {
                const normalizer = inputMagnitude > 1 ? 1 / inputMagnitude : 1;
                ballBody.addForce({
                  x: sampledInputX * normalizer * PHYSICS.desktopDriveForce,
                  y: 0,
                  z: -sampledInputY * normalizer * PHYSICS.desktopDriveForce,
                }, true);
                overviewTarget = 0;
              }
            } else {
              // Mobile keeps the physical tilt fantasy: device/touch input rotates gravity
              // and the board mesh mirrors that tilt while the collision world remains fixed.
              ballBody.setLinearDamping(PHYSICS.linearDamping);
              const targetPitch = sampledInputY * maxTilt;
              const targetRoll = -sampledInputX * maxTilt;
              currentPitch += (targetPitch - currentPitch) * alpha;
              currentRoll += (targetRoll - currentRoll) * alpha;
              euler.set(currentPitch, 0, currentRoll, "XYZ");
              boardQuat.setFromEuler(euler);
              inverseBoardQuat.copy(boardQuat).invert();
              gravityVec.set(0, -PHYSICS.gravity, 0).applyQuaternion(inverseBoardQuat);
              world.gravity.x = gravityVec.x;
              world.gravity.y = gravityVec.y;
              world.gravity.z = gravityVec.z;
            }

            manifest.gates.forEach((gate, i) => {
              const angle = gate.phase + simTime * gate.speed;
              const half = angle / 2;
              gateBodies[i]!.setNextKinematicRotation({ x: 0, y: Math.sin(half), z: 0, w: Math.cos(half) });
            });

            world.step();
            simTime += PHYSICS.fixedStep;
            accumulator -= PHYSICS.fixedStep;

            const v = ballBody.linvel();
            const planarSpeed = Math.hypot(v.x, v.z);
            const speedLimit = controlModeRef.current === "keys" ? PHYSICS.desktopMaxSpeed : PHYSICS.maxSpeed;
            if (planarSpeed > speedLimit) {
              const factor = speedLimit / planarSpeed;
              ballBody.setLinvel({ x: v.x * factor, y: v.y, z: v.z * factor }, true);
            }

            const p = ballBody.translation();
            if (p.y < -2.2) resetBall();

            if (nextCheckpoint < manifest.checkpoints.length) {
              const cp = manifest.checkpoints[nextCheckpoint]!;
              if (Math.hypot(p.x - cp.x, p.z - cp.z) < manifest.cellSize * 0.38) {
                lastSafe = { x: cp.x, z: cp.z };
                nextCheckpoint += 1;
                setCheckpoint(nextCheckpoint);
              }
            }

            if (nextCheckpoint >= manifest.checkpoints.length && Math.hypot(p.x - manifest.goal.x, p.z - manifest.goal.z) < 0.64) {
              const finish = now - startTime;
              setElapsed(finish);
              changePhase("won");
              ballBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
              ballBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
            }

            physicsTick += 1;
          }
        } else {
          accumulator = Math.min(accumulator, PHYSICS.fixedStep);
        }

        boardGroup.quaternion.copy(boardQuat);
        const p = ballBody.translation();
        const r = ballBody.rotation();
        marbleGroup.position.set(p.x, p.y, p.z);
        marbleGroup.quaternion.set(r.x, r.y, r.z, r.w);
        shadowMesh.position.set(p.x, 0.012, p.z);
        const heightFactor = clamp(1 - Math.abs(p.y - PHYSICS.ballRadius) * 0.9, 0.25, 1);
        shadowMesh.scale.setScalar(heightFactor);

        manifest.gates.forEach((gate, i) => {
          const rot = gateBodies[i]!.rotation();
          gateMeshes[i]!.quaternion.set(rot.x, rot.y, rot.z, rot.w);
        });

        if (marbleMaterial.uniforms?.uTime) marbleMaterial.uniforms.uTime.value = now;
        if (floorMaterial.uniforms?.uTime) floorMaterial.uniforms.uTime.value = now;
        goalRing.rotation.z = now * 0.72;
        goalDisc.scale.setScalar(1 + Math.sin(now * 2.2) * 0.08);
        goalBeam.scale.y = 0.92 + Math.sin(now * 1.35) * 0.08;
        checkpointGroups.forEach((g, i) => {
          const active = i === nextCheckpoint;
          g.scale.setScalar(active ? 1 + Math.sin(now * 3) * 0.08 : 1);
          const mat = (g.children[0] as import("three").Mesh).material as import("three").MeshBasicMaterial;
          mat.opacity = i < nextCheckpoint ? 0.08 : active ? 0.7 : 0.28;
        });

        localBall.set(p.x, p.y, p.z);
        const v = ballBody.linvel();
        velocityVec.set(v.x, 0, v.z);

        // Fixed north-up chase framing keeps desktop arrows intuitive: up always moves toward
        // the top of the screen. Velocity only nudges the look target, never the control basis.
        const lookLeadX = clamp(v.x * 0.24, -1.1, 1.1);
        const lookLeadZ = clamp(v.z * 0.24, -1.1, 1.1);
        cameraLocal.set(localBall.x, 5.35, localBall.z + 6.55);
        lookLocal.set(localBall.x + lookLeadX, 0.48, localBall.z + lookLeadZ - 0.65);
        followCameraWorld.copy(cameraLocal).applyQuaternion(boardGroup.quaternion);
        followLookWorld.copy(lookLocal).applyQuaternion(boardGroup.quaternion);

        overviewCameraWorld.set(0, boardExtent * 1.0 + 5.0, boardExtent * 0.55);
        overviewLookWorld.set(0, 0, 0);
        overviewMix += (overviewTarget - overviewMix) * (1 - Math.exp(-dt * 4.6));
        cameraWorld.copy(followCameraWorld).lerp(overviewCameraWorld, overviewMix);
        lookWorld.copy(followLookWorld).lerp(overviewLookWorld, overviewMix);
        camera.position.lerp(cameraWorld, 1 - Math.exp(-dt * 6.2));
        camera.lookAt(lookWorld);

        if (now >= nextHudAt) {
          if (phaseRef.current === "playing") setElapsed(now - startTime);
          setSpeed(Math.hypot(v.x, v.z));
          nextHudAt = now + 0.12;
        }

        frameBudgetSamples += 1;
        frameBudgetTotal += dt * 1000;
        if (frameBudgetSamples >= 180) {
          const averageFrameMs = frameBudgetTotal / frameBudgetSamples;
          const nextDpr = averageFrameMs > 25 ? 1.0 : averageFrameMs > 19 ? Math.min(currentDpr, 1.25) : currentDpr;
          if (nextDpr < currentDpr - 0.01) {
            currentDpr = nextDpr;
            renderer.setPixelRatio(currentDpr);
            resize();
          }
          frameBudgetSamples = 0;
          frameBudgetTotal = 0;
        }

        renderer.render(scene, camera);
      };
      frame = requestAnimationFrame(renderFrame);
      disposeEngine = () => {
        if (!mobileish) {
          renderer.domElement.removeEventListener("pointerdown", onCameraPointerDown);
          renderer.domElement.removeEventListener("pointermove", onCameraPointerMove);
          renderer.domElement.removeEventListener("pointerup", onCameraPointerUp);
          renderer.domElement.removeEventListener("pointercancel", onCameraPointerUp);
        }
        scene.traverse((object) => {
          const mesh = object as import("three").Mesh;
          if (mesh.geometry) mesh.geometry.dispose();
          const material = mesh.material;
          if (Array.isArray(material)) material.forEach((item) => item.dispose());
          else material?.dispose?.();
        });
        renderer.dispose();
      };
    })().catch((error) => {
      console.error("Glass Roller initialization failed", error);
      setLoadingLabel("The game engine could not initialize. Refresh to retry.");
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      resetRef.current = null;
      startRef.current = null;
      cameraReturnRef.current = null;
      disposeEngine?.();
      while (mount.firstChild) mount.removeChild(mount.firstChild);
    };
  }, [changePhase, manifest, style.accent, style.floor, style.marble, style.marbleSecondary, style.walls]);

  const begin = useCallback(() => startRef.current?.(), []);
  const reset = useCallback(() => resetRef.current?.(), []);

  const touchStart = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
  }, []);
  const touchMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    const y = ((event.clientY - rect.top) / rect.height) * 2 - 1;
    const len = Math.max(1, Math.hypot(x, y));
    controlsRef.current.touchX = clamp(x / len, -1, 1);
    controlsRef.current.touchY = clamp(-y / len, -1, 1);
    const knob = event.currentTarget.querySelector<HTMLElement>(".game-touch-knob");
    if (knob) knob.style.transform = `translate(${clamp(x / len, -1, 1) * 30}px, ${clamp(y / len, -1, 1) * 30}px)`;
  }, []);
  const touchEnd = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    controlsRef.current.touchX = 0;
    controlsRef.current.touchY = 0;
    const knob = event.currentTarget.querySelector<HTMLElement>(".game-touch-knob");
    if (knob) knob.style.transform = "translate(0,0)";
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }, []);

  return (
    <section className="glass-roller" style={{ "--game-accent": style.accent, "--game-wall": style.walls } as React.CSSProperties}>
      <div ref={mountRef} className="glass-roller-stage" aria-label="Orbs Glass Roller game canvas" />

      <div className="game-hud game-hud-top">
        <div className="game-hud-chip"><span>ORB</span><strong>{slug}</strong></div>
        <div className="game-hud-chip game-manifest-chip"><span>{manifest.profile.label}</span><strong>#{manifest.manifestId}</strong></div>
        <div className="game-hud-chip"><span>TIME</span><strong>{formatTime(elapsed)}</strong></div>
      </div>

      <div className="game-hud game-hud-bottom">
        <div className="game-hud-chip"><span>CHECKPOINTS</span><strong>{checkpoint}/{manifest.checkpoints.length}</strong></div>
        <div className="game-hud-chip"><span>SPEED</span><strong>{speed.toFixed(1)} m/s</strong></div>
        <button className="game-icon-button" onClick={reset} title="Reset to the latest checkpoint">↻</button>
      </div>

      {phase === "loading" ? (
        <div className="game-overlay">
          <div className="game-loader-orb" />
          <span className="eyebrow">Glass Roller · V1</span>
          <h1>{loadingLabel}</h1>
          <p>Three.js world · Rapier deterministic physics · seeded elite maze</p>
        </div>
      ) : null}

      {phase === "ready" ? (
        <div className="game-overlay game-overlay-card">
          <span className="game-kicker">{manifest.profile.subtitle}</span>
          <h1>Enter the Orb.</h1>
          <p>
            Roll a luminous glass marble through a unique deterministic maze. Desktop gets direct physical steering; mobile keeps the full tilt-board experience.
          </p>
          <div className="game-ready-stats">
            <div><span>PATH</span><strong>{manifest.path.length} cells</strong></div>
            <div><span>MODULES</span><strong>{manifest.gates.length + manifest.bumpers.length}</strong></div>
            <div><span>CONTROL</span><strong>Direct / tilt</strong></div>
          </div>
          <div className="game-ready-actions">
            <button className="btn-primary" onClick={begin}>Start run</button>
            {sensorAvailable ? <button className="btn-secondary" onClick={requestMotion}>Enable device tilt</button> : null}
          </div>
          <div className="game-controls-hint">
            <span>Desktop · ↑ ↓ ← → directly roll the marble</span>
            <span>Desktop camera · drag down to pull back</span>
            <span>Mobile · device tilt or touch pad</span>
            <span>R · recover</span>
          </div>
          {sensorMessage ? <small className="game-sensor-message">{sensorMessage}</small> : null}
        </div>
      ) : null}

      {phase === "countdown" ? <div className="game-countdown">{countdown || "GO"}</div> : null}

      {phase === "won" ? (
        <div className="game-overlay game-overlay-card game-win-card">
          <span className="game-kicker">ORB CLEARED</span>
          <h1>You found the light.</h1>
          <div className="game-win-time">{formatTime(elapsed)}</div>
          <p>{resets === 0 ? "A clean run." : `${resets} recovery ${resets === 1 ? "reset" : "resets"}.`} In a funded Orb, this finish now enters deterministic verification.</p>
          <div className="game-ready-actions">
            <Link className="btn-primary" href={`/orb/${slug}/results`}>Preview winner state</Link>
            <button className="btn-secondary" onClick={() => window.location.reload()}>Run it again</button>
          </div>
        </div>
      ) : null}

      {(phase === "playing" || phase === "ready") && controlMode === "touch" ? (
        <div
          className="game-touch-pad"
          onPointerDown={touchStart}
          onPointerMove={touchMove}
          onPointerUp={touchEnd}
          onPointerCancel={touchEnd}
          aria-label="Touch board tilt control"
        >
          <div className="game-touch-knob" />
          <span>TILT</span>
        </div>
      ) : null}

      {(phase === "playing" || phase === "ready") && controlMode === "keys" ? (
        <div className="game-camera-hint">Drag down on the world to pull back · movement returns to chase view</div>
      ) : null}

      {phase === "playing" && sensorAvailable ? (
        <div className="game-control-switcher">
          {controlMode === "sensor" ? (
            <><button onClick={recalibrate}>Recalibrate</button><button onClick={() => setControlMode("touch")}>Touch control</button></>
          ) : (
            <button onClick={requestMotion}>Device tilt</button>
          )}
        </div>
      ) : null}

      <div className="game-corner-brand"><span className="game-brand-dot" /> orbs.meme</div>
    </section>
  );
}
