"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

type PracticeMode = "maze" | "arena";
type Vec = { x: number; y: number };

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
const distance = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y);

export default function PracticeGame({ mode }: { mode: PracticeMode }) {
  const stageRef = useRef<HTMLDivElement>(null);
  const posRef = useRef<Vec>({ x: 28, y: 58 });
  const velocityRef = useRef<Vec>({ x: 0, y: 0 });
  const keysRef = useRef({ up: false, down: false, left: false, right: false });
  const touchRef = useRef<Vec>({ x: 0, y: 0 });
  const lastRef = useRef(0);
  const lastPaintRef = useRef(0);
  const actionRef = useRef<() => void>(() => undefined);
  const [pos, setPos] = useState(posRef.current);
  const [touch, setTouch] = useState(false);
  const [jumping, setJumping] = useState(false);
  const [power, setPower] = useState<"blaster" | null>(null);
  const [shot, setShot] = useState(false);
  const [rings, setRings] = useState([false, false]);
  const [message, setMessage] = useState(mode === "maze" ? "ROLL THROUGH BOTH RINGS" : "GRAB THE BLASTER RING");

  useEffect(() => {
    const query = window.matchMedia("(pointer: coarse), (hover: none)");
    const sync = () => setTouch(query.matches || window.innerWidth < 760);
    sync();
    query.addEventListener?.("change", sync);
    window.addEventListener("resize", sync);
    return () => { query.removeEventListener?.("change", sync); window.removeEventListener("resize", sync); };
  }, []);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "w", "a", "s", "d", "W", "A", "S", "D", " "].includes(e.key)) e.preventDefault();
      if (e.key === "ArrowUp" || e.key.toLowerCase() === "w") keysRef.current.up = true;
      if (e.key === "ArrowDown" || e.key.toLowerCase() === "s") keysRef.current.down = true;
      if (e.key === "ArrowLeft" || e.key.toLowerCase() === "a") keysRef.current.left = true;
      if (e.key === "ArrowRight" || e.key.toLowerCase() === "d") keysRef.current.right = true;
      if (e.code === "Space" && mode === "arena" && !e.repeat) actionRef.current();
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === "ArrowUp" || e.key.toLowerCase() === "w") keysRef.current.up = false;
      if (e.key === "ArrowDown" || e.key.toLowerCase() === "s") keysRef.current.down = false;
      if (e.key === "ArrowLeft" || e.key.toLowerCase() === "a") keysRef.current.left = false;
      if (e.key === "ArrowRight" || e.key.toLowerCase() === "d") keysRef.current.right = false;
    };
    window.addEventListener("keydown", down, { passive: false });
    window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  }, [mode]);

  useEffect(() => {
    let frame = 0;
    const tick = (now: number) => {
      if (document.hidden) { lastRef.current = now; frame = requestAnimationFrame(tick); return; }
      const dt = Math.min(.032, Math.max(.008, (now - (lastRef.current || now)) / 1000));
      lastRef.current = now;
      const k = keysRef.current;
      let ix = (k.right ? 1 : 0) - (k.left ? 1 : 0);
      let iy = (k.down ? 1 : 0) - (k.up ? 1 : 0);
      if (touch) { ix = touchRef.current.x; iy = touchRef.current.y; }
      const m = Math.hypot(ix, iy) || 1;
      ix /= m; iy /= m;
      const accel = 92;
      velocityRef.current.x += ix * accel * dt;
      velocityRef.current.y += iy * accel * dt;
      const drag = Math.pow(.055, dt);
      velocityRef.current.x *= drag;
      velocityRef.current.y *= drag;
      const speed = Math.hypot(velocityRef.current.x, velocityRef.current.y);
      if (speed > 27) { velocityRef.current.x *= 27 / speed; velocityRef.current.y *= 27 / speed; }
      const p = posRef.current;
      p.x = clamp(p.x + velocityRef.current.x * dt, 7, 93);
      p.y = clamp(p.y + velocityRef.current.y * dt, 10, 90);
      if (now - lastPaintRef.current > 33) { lastPaintRef.current = now; setPos({ ...p }); }

      if (mode === "maze") {
        const targets = [{ x: 49, y: 35 }, { x: 74, y: 66 }];
        setRings(prev => {
          const next = [...prev];
          targets.forEach((target, i) => { if (!next[i] && distance(p, target) < 7) next[i] = true; });
          if (!prev[0] && next[0]) setMessage("NICE · FIND THE NEXT RING");
          if (!prev[1] && next[1]) setMessage("RINGS CLEARED · YOU'VE GOT IT");
          return next as boolean[];
        });
      } else if (!power && distance(p, { x: 66, y: 39 }) < 7) {
        setPower("blaster");
        setMessage(touch ? "BLASTER LOADED · TAP USE POWER" : "BLASTER LOADED · PRESS SPACE");
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [mode, power, touch]);

  const action = useCallback(() => {
    if (mode !== "arena") return;
    if (power) {
      setPower(null);
      setShot(true);
      setMessage("BLASTER FIRED · KEEP MOVING");
      window.setTimeout(() => setShot(false), 650);
      window.setTimeout(() => setMessage("GRAB THE BLASTER RING AGAIN"), 900);
      return;
    }
    if (jumping) return;
    setJumping(true);
    setMessage("JUMP · USE THIS TO CLEAR TERRAIN");
    window.setTimeout(() => setJumping(false), 520);
  }, [jumping, mode, power]);

  actionRef.current = action;

  const pointerMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    const r = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - (r.left + r.width / 2)) / (r.width * .34);
    const y = (e.clientY - (r.top + r.height / 2)) / (r.height * .34);
    const m = Math.max(1, Math.hypot(x, y));
    touchRef.current = { x: clamp(x / m, -1, 1), y: clamp(y / m, -1, 1) };
  }, []);
  const pointerEnd = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    touchRef.current = { x: 0, y: 0 };
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch {}
  }, []);

  const reset = () => {
    posRef.current = { x: 28, y: 58 };
    velocityRef.current = { x: 0, y: 0 };
    setPos(posRef.current);
    setPower(null); setShot(false); setRings([false, false]); setJumping(false);
    setMessage(mode === "maze" ? "ROLL THROUGH BOTH RINGS" : "GRAB THE BLASTER RING");
  };

  return (
    <div className={`practice-game practice-${mode}`} ref={stageRef}>
      <div className="practice-grid" aria-hidden="true" />
      <div className="practice-status"><span>{mode}</span><strong>{message}</strong></div>
      {mode === "maze" ? <>
        <div className={`practice-ring r1 ${rings[0] ? "cleared" : ""}`}><i /></div>
        <div className={`practice-ring r2 ${rings[1] ? "cleared" : ""}`}><i /></div>
        <div className="practice-finish">✦</div>
      </> : <>
        <div className={`practice-power-ring ${power ? "collected" : ""}`}><b>●</b><span>BLASTER</span></div>
        <div className="practice-ramp" aria-hidden="true" />
        {shot ? <div className="practice-shot" style={{ left: `${pos.x + 5}%`, top: `${pos.y}%` }} /> : null}
      </>}
      <div className={`practice-orb ${jumping ? "jumping" : ""} ${power ? "armed" : ""}`} style={{ left: `${pos.x}%`, top: `${pos.y}%` }}><i /></div>

      {touch ? <>
        <div className="practice-joystick" onPointerDown={e => e.currentTarget.setPointerCapture(e.pointerId)} onPointerMove={pointerMove} onPointerUp={pointerEnd} onPointerCancel={pointerEnd}>
          <i /><span>ROLL</span>
        </div>
        {mode === "arena" ? <button className={`practice-action ${power ? "armed" : ""}`} onClick={action}>{power ? "USE POWER" : "JUMP"}</button> : null}
      </> : <div className="practice-key-hint">{mode === "maze" ? "ARROWS / WASD · ROLL" : "ARROWS / WASD · ROLL   ·   SPACE · JUMP / USE POWER"}</div>}
      <button className="practice-reset" onClick={reset}>RESET</button>
    </div>
  );
}
