"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";

type Vec = { x: number; y: number };

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export default function RacePractice() {
  const posRef = useRef<Vec>({ x: 50, y: 76 });
  const speedRef = useRef(0);
  const keysRef = useRef({ up: false, down: false, left: false, right: false });
  const touchSteerRef = useRef(0);
  const touchGasRef = useRef(false);
  const lastRef = useRef(0);
  const paintRef = useRef(0);
  const [pos, setPos] = useState(posRef.current);
  const [speed, setSpeed] = useState(0);
  const [touch, setTouch] = useState(false);
  const [jumping, setJumping] = useState(false);
  const [message, setMessage] = useState("HOLD GAS · STEER THE PRISMWAY");
  const jumpLockedRef = useRef(false);

  useEffect(() => {
    const query = window.matchMedia("(pointer: coarse), (hover: none)");
    const sync = () => setTouch(query.matches || window.innerWidth < 760);
    sync();
    query.addEventListener?.("change", sync);
    window.addEventListener("resize", sync);
    return () => {
      query.removeEventListener?.("change", sync);
      window.removeEventListener("resize", sync);
    };
  }, []);

  const jump = useCallback(() => {
    if (jumpLockedRef.current) return;
    jumpLockedRef.current = true;
    setJumping(true);
    setMessage("JUMP · AIR STEERING IS LIMITED");
    window.setTimeout(() => setJumping(false), 520);
    window.setTimeout(() => {
      jumpLockedRef.current = false;
      setMessage("HOLD GAS · STEER THE PRISMWAY");
    }, 650);
  }, []);

  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (["arrowup", "arrowdown", "arrowleft", "arrowright", "w", "a", "s", "d"].includes(key) || event.code === "Space") {
        event.preventDefault();
      }
      if (key === "arrowup" || key === "w") keysRef.current.up = true;
      if (key === "arrowdown" || key === "s") keysRef.current.down = true;
      if (key === "arrowleft" || key === "a") keysRef.current.left = true;
      if (key === "arrowright" || key === "d") keysRef.current.right = true;
      if (event.code === "Space" && !event.repeat) jump();
    };
    const up = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (key === "arrowup" || key === "w") keysRef.current.up = false;
      if (key === "arrowdown" || key === "s") keysRef.current.down = false;
      if (key === "arrowleft" || key === "a") keysRef.current.left = false;
      if (key === "arrowright" || key === "d") keysRef.current.right = false;
    };
    window.addEventListener("keydown", down, { passive: false });
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [jump]);

  useEffect(() => {
    let frame = 0;
    const tick = (now: number) => {
      if (document.hidden) {
        lastRef.current = now;
        frame = requestAnimationFrame(tick);
        return;
      }
      const dt = Math.min(0.032, Math.max(0.008, (now - (lastRef.current || now)) / 1000));
      lastRef.current = now;

      const keys = keysRef.current;
      const gas = touch ? touchGasRef.current : keys.up;
      const brake = touch ? false : keys.down;
      let steer = touch ? touchSteerRef.current : (keys.right ? 1 : 0) - (keys.left ? 1 : 0);

      const target = gas ? 1 : 0;
      speedRef.current += (target - speedRef.current) * Math.min(1, dt * (gas ? 4.8 : 3.1));
      if (brake) speedRef.current += (0.18 - speedRef.current) * Math.min(1, dt * 8);
      speedRef.current = clamp(speedRef.current, 0, 1);

      // Tiny trainer: lateral steering only. The live game owns real physics.
      const airScale = jumping ? 0.22 : 1;
      const lateralRate = 27 * (0.35 + speedRef.current * 0.65) * airScale;
      posRef.current.x = clamp(posRef.current.x + steer * lateralRate * dt, 25, 75);

      // Keep the Orb visually moving "up track" while gas is held without a scrolling world.
      posRef.current.y = 76 - speedRef.current * 8;

      if (now - paintRef.current > 33) {
        paintRef.current = now;
        setPos({ ...posRef.current });
        setSpeed(speedRef.current);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [jumping, touch]);

  const pointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - (rect.left + rect.width / 2)) / (rect.width * 0.38);
    touchSteerRef.current = clamp(x, -1, 1);
  }, []);

  const pointerEnd = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    touchSteerRef.current = 0;
    try { event.currentTarget.releasePointerCapture(event.pointerId); } catch {}
  }, []);

  const reset = () => {
    posRef.current = { x: 50, y: 76 };
    speedRef.current = 0;
    keysRef.current = { up: false, down: false, left: false, right: false };
    touchSteerRef.current = 0;
    touchGasRef.current = false;
    setPos({ ...posRef.current });
    setSpeed(0);
    setJumping(false);
    jumpLockedRef.current = false;
    setMessage("HOLD GAS · STEER THE PRISMWAY");
  };

  const speedPercent = Math.round(speed * 100);

  return (
    <div className="race-practice-lite" aria-label="Lightweight RACE controls practice">
      <div className="race-lite-sky" aria-hidden="true">
        <i /><i /><i /><i /><i /><i />
      </div>
      <div className="race-lite-track" aria-hidden="true">
        <div className="race-lite-oil" />
        <div className="race-lite-centerline" />
        <div className="race-lite-ramp"><span>JUMP</span></div>
      </div>

      <div className="race-lite-status">
        <span>RACE PRACTICE · LIGHTWEIGHT</span>
        <strong>{message}</strong>
      </div>
      <div className="race-lite-speed"><span>SPEED</span><strong>{speedPercent}%</strong></div>

      <div
        className={`race-lite-orb ${jumping ? "jumping" : ""}`}
        style={{ left: `${pos.x}%`, top: `${pos.y}%`, "--race-lite-speed": speed } as CSSProperties}
      >
        <i />
      </div>

      {touch ? (
        <>
          <div
            className="race-lite-steer"
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              pointerMove(event);
            }}
            onPointerMove={pointerMove}
            onPointerUp={pointerEnd}
            onPointerCancel={pointerEnd}
          >
            <span>← STEER →</span>
          </div>
          <button
            className="race-lite-gas"
            onPointerDown={(event) => {
              event.preventDefault();
              touchGasRef.current = true;
              setMessage("GAS · KEEP YOUR LINE");
            }}
            onPointerUp={() => { touchGasRef.current = false; }}
            onPointerCancel={() => { touchGasRef.current = false; }}
            onPointerLeave={() => { touchGasRef.current = false; }}
          >
            GO
          </button>
          <button className="race-lite-jump" onClick={jump}>JUMP</button>
        </>
      ) : (
        <div className="race-lite-key-hint">
          <span><b>W / ↑</b> GAS</span>
          <span><b>A D / ← →</b> STEER</span>
          <span><b>S / ↓</b> BRAKE</span>
          <span><b>SPACE</b> JUMP + ITEM</span>
        </div>
      )}

      <button className="practice-reset race-lite-reset" onClick={reset}>RESET</button>
      <div className="race-lite-note">CONTROL TRAINER ONLY · LIVE RACE USES THE AUTHORITATIVE MULTIPLAYER PHYSICS ENGINE</div>
    </div>
  );
}
