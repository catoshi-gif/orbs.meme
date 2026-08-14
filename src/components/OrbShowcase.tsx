"use client";

import { useEffect, useRef } from "react";
import { DEFAULT_GAME_STYLE, PHYSICS } from "@/game/constants";
import { generateGameManifest } from "@/game/maze";
import type { GameStyle } from "@/game/types";

type Props = {
  style?: GameStyle;
  compact?: boolean;
  background?: boolean;
  className?: string;
};

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

function makeMountainRing(THREE: typeof import("three"), radius: number, seed: number, y: number, color: string) {
  const segments = 48;
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
  return new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({ color, roughness: 0.92, metalness: 0.08, side: THREE.DoubleSide }),
  );
}

function makeSky(THREE: typeof import("three"), accent: string) {
  return new THREE.Mesh(
    new THREE.SphereGeometry(180, 28, 18),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: { uAccent: { value: new THREE.Color(accent) } },
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
    }),
  );
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
      uProgress: { value: 0 },
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
      uniform float uProgress;
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
        color += mix(uSecondary, uAccent, 0.58) * uProgress * (0.22 + fresnel * 0.72);
        gl_FragColor = vec4(color, 0.94 + fresnel * 0.05);
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
      uniform float uTime;
      void main(){
        vUv = uv;
        vec3 transformed = position;
        float rippleA = sin(uv.x * 17.0 + uv.y * 9.0 + uTime * 0.38);
        float rippleB = sin(uv.y * 21.0 - uv.x * 7.0 - uTime * 0.27);
        transformed.z += (rippleA + rippleB) * 0.012;
        vec4 world = modelMatrix * vec4(transformed,1.0);
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
        float fresnel = pow(1.0 - max(dot(normalize(vNormalW), viewDir), 0.0), 2.25);
        float waveA = sin(vUv.x * 9.0 + vUv.y * 6.0 + uTime * 0.26);
        float waveB = sin(vUv.y * 12.0 - vUv.x * 4.0 - uTime * 0.19);
        float waveC = sin((vUv.x + vUv.y) * 14.0 + uTime * 0.13);
        float crystal = 0.5 + 0.5 * sin(waveA * 1.18 + waveB * 0.88 + waveC * 0.43);
        float vein = smoothstep(0.82, 0.985, crystal);
        float centerGlow = 1.0 - smoothstep(0.06, 0.8, length(p));
        vec3 base = uFloor * 0.24;
        base += uSecondary * (0.045 + crystal * 0.072);
        base += uAccent * (0.032 + vein * 0.26 + centerGlow * 0.038);
        base += mix(uSecondary, vec3(1.0), 0.20) * fresnel * 0.19;
        gl_FragColor = vec4(base, 0.245 + crystal * 0.055 + fresnel * 0.075 + vein * 0.025);
      }
    `,
  });
}

function makeRoundedWallGeometry(THREE: typeof import("three"), thickness: number, height: number, radius: number) {
  const halfW = thickness / 2;
  const halfH = height / 2;
  const r = Math.min(radius, halfW * 0.92, halfH * 0.28);
  const shape = new THREE.Shape();
  shape.moveTo(-halfW + r, -halfH);
  shape.lineTo(halfW - r, -halfH);
  shape.quadraticCurveTo(halfW, -halfH, halfW, -halfH + r);
  shape.lineTo(halfW, halfH - r);
  shape.quadraticCurveTo(halfW, halfH, halfW - r, halfH);
  shape.lineTo(-halfW + r, halfH);
  shape.quadraticCurveTo(-halfW, halfH, -halfW, halfH - r);
  shape.lineTo(-halfW, -halfH + r);
  shape.quadraticCurveTo(-halfW, -halfH, -halfW + r, -halfH);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: 1,
    bevelEnabled: false,
    steps: 1,
    curveSegments: 3,
  });
  geometry.translate(0, 0, -0.5);
  geometry.computeVertexNormals();
  return geometry;
}

export default function OrbShowcase({ style = DEFAULT_GAME_STYLE, compact = false, background = false, className = "" }: Props) {
  const shellRef = useRef<HTMLDivElement>(null);
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const shell = shellRef.current;
    const mount = mountRef.current;
    if (!shell || !mount) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let visible = false;
    let disposed = false;
    let started = false;
    let cleanupScene: (() => void) | null = null;
    let idleId: number | null = null;

    const start = () => {
      if (started || disposed || !visible) return;
      started = true;

      const run = async () => {
        const THREE = await import("three");
        if (disposed || !mount.isConnected || !visible) { started = false; return; }

        // This is an actual deterministic maze from the production generator.
        // It is representative only: it never uses a live Orb's slug/seed.
        const manifest = generateGameManifest("orbs-public-showcase-v1", "quick", style);

        const displayWall = new THREE.Color(style.walls).lerp(new THREE.Color("#FFFFFF"), 0.18);
        const displayAccent = new THREE.Color(style.accent).lerp(new THREE.Color("#7EF5FF"), 0.12);
        const displaySecondary = new THREE.Color(style.marbleSecondary).lerp(new THREE.Color("#E8FFFF"), 0.16);
        const displayFloor = new THREE.Color(style.floor).lerp(new THREE.Color("#050817"), 0.46);
        const wallHex = `#${displayWall.getHexString()}`;
        const accentHex = `#${displayAccent.getHexString()}`;
        const secondaryHex = `#${displaySecondary.getHexString()}`;
        const floorHex = `#${displayFloor.getHexString()}`;

        const scene = new THREE.Scene();
        scene.background = new THREE.Color("#050817");
        scene.fog = new THREE.FogExp2("#080D25", 0.015);

        const mobileish = window.matchMedia("(pointer: coarse)").matches || window.innerWidth < 760;
        const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
        const constrainedDevice = Boolean((nav.deviceMemory && nav.deviceMemory <= 2) || nav.connection?.saveData);
        const camera = new THREE.PerspectiveCamera(background ? (compact ? 54 : 50) : compact ? 50 : 47, 1, 0.08, 240);

        const renderer = new THREE.WebGLRenderer({
          antialias: !mobileish,
          alpha: false,
          powerPreference: "low-power",
        });
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.02;
        renderer.setPixelRatio(Math.min(
          window.devicePixelRatio || 1,
          constrainedDevice ? 0.5 : background ? (mobileish ? 0.58 : 0.78) : mobileish ? 0.75 : 1,
        ));
        renderer.domElement.className = "orb-showcase-canvas";
        renderer.domElement.setAttribute("aria-hidden", "true");
        mount.replaceChildren(renderer.domElement);

        const hemi = new THREE.HemisphereLight("#8CF6FF", "#07091B", 1.9);
        const key = new THREE.DirectionalLight("#A7DBFF", 2.8);
        key.position.set(-12, 20, 9);
        const rim = new THREE.DirectionalLight(accentHex, 2.2);
        rim.position.set(12, 7, -14);
        scene.add(hemi, key, rim, makeSky(THREE, accentHex));
        scene.add(
          makeMountainRing(THREE, 45, manifest.seed, -2.2, "#10183C"),
          makeMountainRing(THREE, 54, manifest.seed + 991, -2.4, "#09112B"),
        );

        const starCount = constrainedDevice ? 96 : mobileish ? 180 : 320;
        const starGeometry = new THREE.BufferGeometry();
        const stars = new Float32Array(starCount * 3);
        let starSeed = manifest.seed || 1;
        const rand = () => {
          starSeed ^= starSeed << 13;
          starSeed ^= starSeed >>> 17;
          starSeed ^= starSeed << 5;
          return ((starSeed >>> 0) % 100000) / 100000;
        };
        for (let i = 0; i < starCount; i += 1) {
          const theta = rand() * Math.PI * 2;
          const radius = 70 + rand() * 90;
          stars[i * 3] = Math.cos(theta) * radius;
          stars[i * 3 + 1] = 8 + rand() * 70;
          stars[i * 3 + 2] = Math.sin(theta) * radius;
        }
        starGeometry.setAttribute("position", new THREE.BufferAttribute(stars, 3));
        scene.add(new THREE.Points(
          starGeometry,
          new THREE.PointsMaterial({ color: "#CBE8FF", size: 0.085, transparent: true, opacity: 0.72 }),
        ));

        const board = new THREE.Group();
        scene.add(board);

        const floorMaterial = makeFloorMaterial(THREE, floorHex, secondaryHex, accentHex);
        const floor = new THREE.Mesh(new THREE.PlaneGeometry(manifest.width, manifest.depth, 18, 18), floorMaterial);
        floor.rotation.x = -Math.PI / 2;
        floor.position.y = -0.005;
        board.add(floor);

        const floorGlow = new THREE.Mesh(
          new THREE.PlaneGeometry(manifest.width * 1.006, manifest.depth * 1.006),
          new THREE.MeshBasicMaterial({
            color: accentHex,
            transparent: true,
            opacity: 0.035,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
          }),
        );
        floorGlow.rotation.x = -Math.PI / 2;
        floorGlow.position.y = -0.035;
        board.add(floorGlow);

        const wallThickness = PHYSICS.wallThickness * 1.18;
        const wallGeometry = makeRoundedWallGeometry(THREE, wallThickness, PHYSICS.wallHeight, wallThickness * 0.38);
        const wallMaterial = new THREE.MeshPhysicalMaterial({
          color: wallHex,
          emissive: displayWall.clone().multiplyScalar(0.12),
          emissiveIntensity: 0.72,
          transparent: true,
          opacity: 0.52,
          roughness: 0.22,
          metalness: 0.06,
          clearcoat: 0.92,
          clearcoatRoughness: 0.14,
          ior: 1.36,
          depthWrite: true,
          side: THREE.DoubleSide,
        });
        const walls = new THREE.InstancedMesh(wallGeometry, wallMaterial, manifest.walls.length);
        const matrix = new THREE.Matrix4();
        const position = new THREE.Vector3();
        const scale = new THREE.Vector3();
        const noRotation = new THREE.Quaternion();
        const rotateY = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
        const overlap = PHYSICS.wallThickness * 0.48;
        manifest.walls.forEach((wall, index) => {
          position.set(wall.x, PHYSICS.wallHeight / 2, wall.z);
          scale.set(1, 1, wall.length + overlap);
          matrix.compose(position, wall.axis === "x" ? rotateY : noRotation, scale);
          walls.setMatrixAt(index, matrix);
        });
        walls.instanceMatrix.needsUpdate = true;
        board.add(walls);

        const checkpointGroups = manifest.checkpoints.map((checkpoint, index) => {
          const group = new THREE.Group();
          group.position.set(checkpoint.x, 0.025, checkpoint.z);
          const ring = new THREE.Mesh(
            new THREE.RingGeometry(0.43, 0.61, 36),
            new THREE.MeshBasicMaterial({
              color: index === 0 ? secondaryHex : accentHex,
              transparent: true,
              opacity: 0.52,
              side: THREE.DoubleSide,
              blending: THREE.AdditiveBlending,
              depthWrite: false,
            }),
          );
          ring.rotation.x = -Math.PI / 2;
          const halo = new THREE.Mesh(
            new THREE.CylinderGeometry(0.53, 0.53, 0.65, 28, 1, true),
            new THREE.MeshBasicMaterial({
              color: accentHex,
              transparent: true,
              opacity: 0.07,
              side: THREE.DoubleSide,
              blending: THREE.AdditiveBlending,
              depthWrite: false,
            }),
          );
          halo.position.y = 0.31;
          group.add(ring, halo);
          board.add(group);
          return group;
        });

        const goal = new THREE.Group();
        goal.position.set(manifest.goal.x, 0.035, manifest.goal.z);
        const goalDisc = new THREE.Mesh(
          new THREE.CircleGeometry(0.78, 40),
          new THREE.MeshBasicMaterial({
            color: accentHex,
            transparent: true,
            opacity: 0.25,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
          }),
        );
        goalDisc.rotation.x = -Math.PI / 2;
        const goalRing = new THREE.Mesh(
          new THREE.TorusGeometry(0.72, 0.07, 10, 36),
          new THREE.MeshBasicMaterial({ color: secondaryHex, transparent: true, opacity: 0.95 }),
        );
        goalRing.rotation.x = Math.PI / 2;
        goal.add(goalDisc, goalRing);
        board.add(goal);

        // The marble follows the generator's real solved path, so every turn lines up
        // with an actual corridor instead of floating through decorative geometry.
        const checkpointPathIndexes = manifest.checkpoints
          .map((checkpoint) => manifest.path.findIndex((point) => point.x === checkpoint.x && point.z === checkpoint.z))
          .filter((index) => index >= 0);
        const segmentStart = Math.max(0, (checkpointPathIndexes[0] ?? 6) - 5);
        const segmentEnd = Math.min(
          manifest.path.length - 1,
          (checkpointPathIndexes[1] ?? Math.min(manifest.path.length - 1, segmentStart + 22)) + 5,
        );
        const showcasePath = manifest.path.slice(segmentStart, Math.max(segmentStart + 2, segmentEnd + 1));
        const pathPoints = showcasePath.map((point) => new THREE.Vector3(point.x, PHYSICS.ballRadius + 0.04, point.z));
        const samplePath = (progress: number, outPoint: import("three").Vector3, outTangent: import("three").Vector3) => {
          const maxSegment = Math.max(1, pathPoints.length - 1);
          const scaled = clamp01(progress) * maxSegment;
          const segment = Math.min(maxSegment - 1, Math.floor(scaled));
          const local = scaled - segment;
          const from = pathPoints[segment]!;
          const to = pathPoints[segment + 1]!;
          outPoint.copy(from).lerp(to, local);
          outTangent.copy(to).sub(from).normalize();
        };

        const marbleMaterial = makeMarbleMaterial(THREE, style.marble, secondaryHex, accentHex);
        const marble = new THREE.Group();
        const marbleMesh = new THREE.Mesh(
          new THREE.SphereGeometry(PHYSICS.ballRadius, mobileish ? 24 : 34, mobileish ? 16 : 22),
          marbleMaterial,
        );
        const core = new THREE.Mesh(
          new THREE.SphereGeometry(PHYSICS.ballRadius * 0.78, 20, 14),
          new THREE.MeshBasicMaterial({
            color: secondaryHex,
            transparent: true,
            opacity: 0.16,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
          }),
        );
        const glow = new THREE.PointLight(accentHex, 0.55, 4.0, 2.0);
        glow.position.y = 0.18;
        marble.add(marbleMesh, core, glow);
        board.add(marble);

        const resize = () => {
          const rect = mount.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0) return;
          camera.aspect = rect.width / rect.height;
          camera.updateProjectionMatrix();
          renderer.setSize(Math.max(1, rect.width), Math.max(1, rect.height), false);
        };
        const resizeObserver = new ResizeObserver(resize);
        resizeObserver.observe(mount);
        resize();

        let raf = 0;
        let lastRender = 0;
        let lastCameraFrame = 0;
        let previousCycle = 0;
        let cameraRigReady = false;
        const startedAt = performance.now();
        const frameInterval = 1000 / (constrainedDevice ? 12 : background ? (mobileish ? 18 : 24) : mobileish ? 20 : 28);
        const duration = compact ? 12_500 : 11_000;
        const cameraPosition = new THREE.Vector3();
        const cameraTarget = new THREE.Vector3();
        const smoothedTarget = new THREE.Vector3();
        const smoothedDirection = new THREE.Vector3();
        const desiredDirection = new THREE.Vector3();
        const aheadPoint = new THREE.Vector3();
        const aheadTangent = new THREE.Vector3();
        const tangent = new THREE.Vector3();
        const point = new THREE.Vector3();
        const lookMatrix = new THREE.Matrix4();
        const desiredQuaternion = new THREE.Quaternion();

        const renderFrame = (now: number) => {
          if (disposed) return;
          raf = window.requestAnimationFrame(renderFrame);
          if (!visible || document.hidden || now - lastRender < frameInterval) return;
          const dt = lastCameraFrame ? Math.min(0.08, Math.max(0.001, (now - lastCameraFrame) / 1000)) : 1 / 24;
          lastRender = now;
          lastCameraFrame = now;

          const cycle = ((now - startedAt) % duration) / duration;
          // Reserve the end of the cycle for a soft reset rather than a visible teleport.
          const travel = clamp01(cycle / 0.90);
          const eased = travel * travel * (3 - 2 * travel);
          samplePath(eased, point, tangent);

          marble.position.copy(point);
          marbleMesh.rotation.z -= 0.055;
          marbleMesh.rotation.x += 0.035;
          marbleMaterial.uniforms.uTime.value = now / 1000;
          marbleMaterial.uniforms.uProgress.value = eased;
          floorMaterial.uniforms.uTime.value = now / 1000;

          // The marble still follows the exact production-solver corridor path. The
          // camera, however, looks well ahead on that path and damps its heading,
          // position and rotation independently. This removes the old 90-degree
          // lookAt snaps at corridor corners without altering marble motion at all.
          const cameraDistance = compact ? 6.35 : 7.05;
          const cameraHeight = compact ? 4.75 : 5.35;
          const lookAheadProgress = Math.min(1, eased + (compact ? 0.075 : 0.065));
          samplePath(lookAheadProgress, aheadPoint, aheadTangent);
          desiredDirection.copy(aheadPoint).sub(point);
          if (desiredDirection.lengthSq() < 0.0001) desiredDirection.copy(tangent);
          desiredDirection.normalize();

          // Reset the invisible camera rig at the loop seam while the canvas is faded.
          if (cycle < previousCycle) cameraRigReady = false;
          previousCycle = cycle;

          const directionAlpha = 1 - Math.exp(-dt * 2.65);
          if (!cameraRigReady) smoothedDirection.copy(desiredDirection);
          else smoothedDirection.lerp(desiredDirection, directionAlpha).normalize();

          cameraPosition.copy(point).addScaledVector(smoothedDirection, -cameraDistance);
          cameraPosition.y = cameraHeight;
          cameraTarget.copy(point).addScaledVector(smoothedDirection, compact ? 2.15 : 2.55);
          cameraTarget.y = 0.18;

          const positionAlpha = 1 - Math.exp(-dt * 3.45);
          const targetAlpha = 1 - Math.exp(-dt * 3.0);
          const rotationAlpha = 1 - Math.exp(-dt * 4.2);
          if (!cameraRigReady) {
            camera.position.copy(cameraPosition);
            smoothedTarget.copy(cameraTarget);
            camera.lookAt(smoothedTarget);
            cameraRigReady = true;
          } else {
            camera.position.lerp(cameraPosition, positionAlpha);
            smoothedTarget.lerp(cameraTarget, targetAlpha);
            lookMatrix.lookAt(camera.position, smoothedTarget, camera.up);
            desiredQuaternion.setFromRotationMatrix(lookMatrix);
            camera.quaternion.slerp(desiredQuaternion, rotationAlpha);
          }

          checkpointGroups.forEach((group, index) => {
            const pulse = 1 + Math.sin(now * 0.004 + index * 1.1) * 0.07;
            group.scale.setScalar(pulse);
          });
          goalRing.rotation.z += 0.008;

          const fadeOut = cycle > 0.93 ? clamp01((1 - cycle) / 0.07) : 1;
          const fadeIn = cycle < 0.035 ? clamp01(cycle / 0.035) : 1;
          renderer.domElement.style.opacity = String(Math.min(fadeOut, fadeIn));

          renderer.render(scene, camera);
        };

        if (reduceMotion) {
          samplePath(0.38, point, tangent);
          samplePath(0.46, aheadPoint, aheadTangent);
          desiredDirection.copy(aheadPoint).sub(point);
          if (desiredDirection.lengthSq() < 0.0001) desiredDirection.copy(tangent);
          desiredDirection.normalize();
          marble.position.copy(point);
          camera.position.copy(point).addScaledVector(desiredDirection, compact ? -6.2 : -6.8);
          camera.position.y = compact ? 4.7 : 5.2;
          cameraTarget.copy(point).addScaledVector(desiredDirection, 2.2);
          cameraTarget.y = 0.18;
          camera.lookAt(cameraTarget);
          renderer.render(scene, camera);
        } else {
          raf = window.requestAnimationFrame(renderFrame);
        }

        cleanupScene = () => {
          window.cancelAnimationFrame(raf);
          resizeObserver.disconnect();
          scene.traverse((object) => {
            const mesh = object as import("three").Mesh;
            if (mesh.geometry) mesh.geometry.dispose();
            const material = mesh.material;
            if (Array.isArray(material)) material.forEach((item) => item.dispose());
            else if (material) material.dispose();
          });
          renderer.dispose();
          renderer.forceContextLoss();
          mount.replaceChildren();
        };
      };

      const idleWindow = window as Window & {
        requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
      };
      if (typeof idleWindow.requestIdleCallback === "function") {
        idleId = idleWindow.requestIdleCallback(() => void run(), { timeout: 1200 });
      } else {
        window.setTimeout(() => void run(), 120);
      }
    };

    const observer = new IntersectionObserver(
      (entries) => {
        visible = Boolean(entries[0]?.isIntersecting);
        if (visible) start();
      },
      { rootMargin: "160px 0px", threshold: 0.03 },
    );
    observer.observe(shell);

    return () => {
      disposed = true;
      observer.disconnect();
      const idleWindow = window as Window & { cancelIdleCallback?: (id: number) => void };
      if (idleId !== null && typeof idleWindow.cancelIdleCallback === "function") idleWindow.cancelIdleCallback(idleId);
      cleanupScene?.();
    };
  }, [background, compact, style]);

  return (
    <div
      ref={shellRef}
      className={`orb-showcase ${compact ? "compact" : ""} ${background ? "background" : ""} ${className}`.trim()}
      aria-hidden="true"
    >
      <div ref={mountRef} className="orb-showcase-mount" />
      <div className="orb-showcase-vignette" />
    </div>
  );
}
