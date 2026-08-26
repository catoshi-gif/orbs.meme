export const RACE_GAME_VERSION = "orb-race-v1";
export const RACE_LAPS = 3;
export const RACE_MAX_PLAYERS = 50;
export const RACE_RESCUE_MS = 3000;
export function buildRaceConfig(playerCount) {
    return {
        playerCount: Math.max(2, Math.min(RACE_MAX_PLAYERS, Math.floor(playerCount))),
        baseSpeed: 17.82,
        maxSpeed: 24.21,
        boostSpeed: 32.98,
        jumpImpulse: 6.8,
        jumpCooldownMs: 520,
        steeringStrength: 1.18,
        trackWidth: playerCount > 36 ? 15.2 : 14.2,
        laps: RACE_LAPS,
    };
}
function xmur3(input) {
    let h = 1779033703 ^ input.length;
    for (let i = 0; i < input.length; i++) {
        h = Math.imul(h ^ input.charCodeAt(i), 3432918353);
        h = (h << 13) | (h >>> 19);
    }
    return () => {
        h = Math.imul(h ^ (h >>> 16), 2246822507);
        h = Math.imul(h ^ (h >>> 13), 3266489909);
        return (h ^= h >>> 16) >>> 0;
    };
}
function mulberry32(seed) {
    return () => {
        let t = (seed += 0x6d2b79f5);
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
function smoothstep(a, b, x) {
    const t = Math.max(0, Math.min(1, (x - a) / Math.max(1e-6, b - a)));
    return t * t * (3 - 2 * t);
}
function windowPulse(t, start, peak, end) {
    const tt = ((t % 1) + 1) % 1;
    if (tt < start || tt > end)
        return 0;
    if (tt <= peak)
        return smoothstep(start, peak, tt);
    return 1 - smoothstep(peak, end, tt);
}
function circularDiff(a, b) {
    let d = a - b;
    while (d > 0.5)
        d -= 1;
    while (d < -0.5)
        d += 1;
    return d;
}
export function generateRaceManifest(seed, style, trackWidth = 14.2) {
    const hash = xmur3(`${RACE_GAME_VERSION}:${seed}`);
    const rand = mulberry32(hash());
    const samples = 288;
    const baseRadius = 108 + rand() * 10;
    const phase1 = rand() * Math.PI * 2;
    const phase2 = rand() * Math.PI * 2;
    const phase3 = rand() * Math.PI * 2;
    const amp1 = 0.11 + rand() * 0.045;
    const amp2 = 0.055 + rand() * 0.035;
    const amp3 = 0.028 + rand() * 0.025;
    const harmonic1 = 2 + Math.floor(rand() * 2);
    const harmonic2 = 4 + Math.floor(rand() * 2);
    const harmonic3 = 6 + Math.floor(rand() * 3);
    const elevationPhase = rand() * Math.PI * 2;
    const plungeCenter = 0.60 + (rand() - 0.5) * 0.055;
    const plungeStartT = plungeCenter - 0.118;
    const launchT = plungeCenter;
    // Keep the hero jump visually enormous without making the missing-road chasm impossible.
    // The Orb still spends several seconds airborne; the actual collider gap is intentionally
    // much shorter than V2 so a clean launch always reaches forgiving pavement.
    const landT = plungeCenter + 0.058;
    // A second guaranteed signature module, positioned differently for every seed.
    // Unlike the chasm jump, this road stays continuous while dropping away beneath the Orb.
    const gravityDiveCrestT = 0.285 + (rand() - 0.5) * 0.075;
    const gravityDiveCatchT = gravityDiveCrestT + 0.058 + rand() * 0.012;
    const gravityDiveRiseT = gravityDiveCrestT - 0.155 - rand() * 0.025;
    const gravityDiveHeight = 38 + rand() * 9;
    const widthPhase1 = rand() * Math.PI * 2;
    const widthPhase2 = rand() * Math.PI * 2;
    const raw = [];
    for (let i = 0; i < samples; i++) {
        const t = i / samples;
        const a = t * Math.PI * 2;
        const r = baseRadius * (1 +
            Math.sin(a * harmonic1 + phase1) * amp1 +
            Math.sin(a * harmonic2 + phase2) * amp2 +
            Math.sin(a * harmonic3 + phase3) * amp3);
        const angularWarp = Math.sin(a * 3 + phase2) * 0.045 + Math.sin(a * 5 + phase3) * 0.018;
        const aw = a + angularWarp;
        let y = 5.0 + Math.sin(a * 2 + elevationPhase) * 4.8 + Math.sin(a * 5 + phase1) * 2.1;
        // GRAVITY DIVE: climb to a huge summit, then make the road plunge away beneath the racer.
        // The road remains continuous; gameplay releases the Orb ballistically from the crest.
        const gravityRise = smoothstep(gravityDiveRiseT, gravityDiveCrestT - 0.020, t);
        const gravityDrop = smoothstep(gravityDiveCrestT - 0.010, gravityDiveCatchT, t);
        y += Math.max(0, gravityRise - gravityDrop) * gravityDiveHeight;
        // Signature sequence is deliberately authored inside the random course envelope: a high crest,
        // long gravity-assisted descent, shallow kicker, open-air gap and forgiving broad landing.
        // Keeping this module smooth prevents a valid random seed from creating a near-vertical launch wall.
        const plungeRise = smoothstep(plungeStartT - 0.24, plungeStartT - 0.05, t);
        const plungeFall = smoothstep(plungeStartT - 0.048, launchT - 0.018, t);
        y += Math.max(0, plungeRise - plungeFall) * 35;
        // Missing-road section is ~24–34m on normal generated laps: dramatic, but safely
        // inside the launch envelope. Long airtime comes from the ballistic arc, not a lethal void.
        const gap = t > launchT + 0.012 && t < landT - 0.018;
        const landingWidth = windowPulse(t, landT - 0.024, landT + 0.024, landT + 0.108);
        const gravityCatchWidth = windowPulse(t, gravityDiveCatchT - 0.030, gravityDiveCatchT + 0.020, gravityDiveCatchT + 0.095);
        // Smooth width topology: mostly generous, with occasional dramatic narrow and grandstand-wide sections.
        // Width changes are low-frequency so the road never pinches abruptly under a racer.
        const widthField = Math.sin(a * 2 + widthPhase1) * 0.22 +
            Math.sin(a * 4 + widthPhase2) * 0.15 +
            Math.sin(a * 7 + widthPhase1 * 0.7) * 0.075;
        // Deliberate visual rhythm: a couple of obvious squeeze/chicane sections and one broad
        // "grandstand" section. These are smooth pulses, never abrupt width cliffs.
        const narrowPulse = windowPulse(t, 0.295, 0.345, 0.410) * 0.30 +
            windowPulse(t, 0.735, 0.775, 0.825) * 0.20;
        const widePulse = windowPulse(t, 0.055, 0.125, 0.205) * 0.33 +
            windowPulse(t, 0.455, 0.495, 0.545) * 0.22;
        const widthScale = Math.max(0.56, Math.min(1.60, 1 + widthField - narrowPulse + widePulse + landingWidth * 0.62 + gravityCatchWidth * 0.42));
        const width = trackWidth * widthScale;
        const bank = (Math.sin(a * harmonic1 + phase1) * 0.14 + Math.sin(a * harmonic2 + phase2) * 0.08) * (1 - landingWidth * 0.6);
        raw.push({ x: Math.cos(aw) * r, y, z: Math.sin(aw) * r, bank, width, gap });
    }
    let cumulative = 0;
    const points = [];
    for (let i = 0; i < samples; i++) {
        const prev = raw[(i - 1 + samples) % samples];
        const cur = raw[i];
        const next = raw[(i + 1) % samples];
        let tx = next.x - prev.x, ty = next.y - prev.y, tz = next.z - prev.z;
        const tm = Math.hypot(tx, ty, tz) || 1;
        tx /= tm;
        ty /= tm;
        tz /= tm;
        // Build a true lateral axis, then bank it around the 3D tangent. This keeps the road
        // cross-section perpendicular to the centerline even on the steep signature descent.
        let rx = tz, rz = -tx;
        const rm = Math.hypot(rx, rz) || 1;
        rx /= rm;
        rz /= rm;
        const cb = Math.cos(cur.bank), sb = Math.sin(cur.bank);
        const crossX = ty * rz;
        const crossY = tz * rx - tx * rz;
        const crossZ = -ty * rx;
        const bx = rx * cb + crossX * sb;
        const by = crossY * sb;
        const bz = rz * cb + crossZ * sb;
        if (i > 0) {
            const p = raw[i - 1];
            cumulative += Math.hypot(cur.x - p.x, cur.y - p.y, cur.z - p.z);
        }
        points.push({
            index: i, t: i / samples, x: cur.x, y: cur.y, z: cur.z,
            tangentX: tx, tangentY: ty, tangentZ: tz,
            rightX: bx, rightY: by, rightZ: bz,
            bank: cur.bank, width: cur.width, distance: cumulative, gap: cur.gap,
        });
    }
    const first = raw[0], last = raw[raw.length - 1];
    const lapLength = cumulative + Math.hypot(first.x - last.x, first.y - last.y, first.z - last.z);
    const idx = (t) => ((Math.round((((t % 1) + 1) % 1) * samples) % samples) + samples) % samples;
    const occupied = new Set();
    const reserve = (target) => {
        let candidate = target;
        for (let tries = 0; tries < samples; tries++) {
            const p = points[candidate];
            if (!p.gap && !occupied.has(candidate)) {
                occupied.add(candidate);
                return candidate;
            }
            candidate = (candidate + 1) % samples;
        }
        return target;
    };
    const boosts = [];
    const boostTs = [0.075, 0.19, 0.315, launchT - 0.032, landT + 0.095, 0.79, 0.91];
    boostTs.forEach((t, i) => boosts.push({ id: `boost-${i}`, pointIndex: reserve(idx(t)), lane: i % 2 ? -0.22 : 0.22 }));
    const pickups = [];
    const pickupTs = [0.13, 0.255, 0.39, landT + 0.15, 0.73, 0.855];
    const pickupKinds = ["missile", "bomb", "turbo", "missile", "bomb", "turbo"];
    pickupTs.forEach((t, i) => pickups.push({ id: `item-${i}`, kind: pickupKinds[i], pointIndex: reserve(idx(t)), lane: i % 3 === 0 ? -0.28 : i % 3 === 1 ? 0.28 : 0 }));
    const ramps = [];
    [0.22, 0.425, 0.82].forEach((t, i) => ramps.push({ id: `ramp-${i}`, pointIndex: reserve(idx(t)), lane: i === 1 ? -0.18 : i === 2 ? 0.2 : 0 }));
    return {
        version: RACE_GAME_VERSION,
        seed,
        style,
        points,
        pickups,
        boosts,
        ramps,
        lapLength,
        trackWidth,
        plungeStartIndex: idx(plungeStartT),
        plungeLaunchIndex: idx(launchT),
        plungeLandIndex: idx(landT),
        gravityDiveCrestIndex: idx(gravityDiveCrestT),
        gravityDiveCatchIndex: idx(gravityDiveCatchT),
    };
}
export function safeRaceRecoveryPoint(points, hint, plungeLaunchIndex) {
    const n = points.length;
    const wrap = (i) => ((i % n) + n) % n;
    const safeRunway = (i) => {
        // Require actual road under the drop point plus enough road on both sides to settle,
        // accelerate and avoid being placed onto the lip of a chasm.
        for (let d = -3; d <= 10; d++)
            if (points[wrap(i + d)].gap)
                return false;
        return true;
    };
    // If the fall happened around the signature jump, prefer a known runway before the launch.
    if (typeof plungeLaunchIndex === "number") {
        const delta = Math.min((wrap(hint - plungeLaunchIndex) + n) % n, (wrap(plungeLaunchIndex - hint) + n) % n);
        if (delta < 42) {
            for (let back = 12; back <= 42; back++) {
                const i = wrap(plungeLaunchIndex - back);
                if (safeRunway(i))
                    return i;
            }
        }
    }
    // Ordinary fall: walk backwards until we find a contiguous, non-gap recovery runway.
    for (let back = 7; back <= Math.min(n - 1, 72); back++) {
        const i = wrap(hint - back);
        if (safeRunway(i))
            return i;
    }
    // Defensive fallback. Generator validation should make this unreachable.
    for (let i = 0; i < n; i++)
        if (safeRunway(i))
            return i;
    return 0;
}
export function safeRaceGatePoint(points, targetIndex, forbiddenCenter) {
    const n = points.length;
    const wrap = (i) => ((i % n) + n) % n;
    const circular = (a, b) => { const d = Math.abs(a - b); return Math.min(d, n - d); };
    const safe = (i) => {
        if (typeof forbiddenCenter === "number" && circular(i, forbiddenCenter) < 26)
            return false;
        // Gate poles need actual pavement beneath them and several road samples on both sides.
        for (let d = -5; d <= 7; d++)
            if (points[wrap(i + d)].gap)
                return false;
        return true;
    };
    for (let radius = 0; radius < Math.min(64, n / 2); radius++) {
        const forward = wrap(targetIndex + radius);
        if (safe(forward))
            return forward;
        const backward = wrap(targetIndex - radius);
        if (safe(backward))
            return backward;
    }
    for (let i = 0; i < n; i++)
        if (safe(i))
            return i;
    return wrap(targetIndex);
}
export function nearestRacePoint(points, x, y, z, hint) {
    const n = points.length;
    let best = typeof hint === "number" ? ((hint % n) + n) % n : 0;
    let bestD = Number.POSITIVE_INFINITY;
    const scan = (i) => {
        const p = points[(i + n) % n];
        const dx = x - p.x, dy = (y - p.y) * 0.35, dz = z - p.z;
        const d = dx * dx + dy * dy + dz * dz;
        if (d < bestD) {
            bestD = d;
            best = p.index;
        }
    };
    if (typeof hint === "number") {
        for (let d = -26; d <= 34; d++)
            scan(hint + d);
        // Recovery/teleport guard: if the local window is implausibly far, perform a full scan.
        if (bestD > 38 * 38)
            for (let i = 0; i < n; i++)
                scan(i);
    }
    else {
        for (let i = 0; i < n; i++)
            scan(i);
    }
    return { point: points[best], distanceSq: bestD };
}
export function raceProgress(pointIndex, lap, pointCount) {
    return lap * pointCount + pointIndex;
}
export function circularPointDistance(a, b, count) {
    const d = Math.abs(a - b);
    return Math.min(d, count - d);
}
export function isNearPlunge(pointIndex, manifest, radius = 16) {
    return circularPointDistance(pointIndex, manifest.plungeLaunchIndex, manifest.points.length) <= radius;
}
export function progressDelta(previousIndex, nextIndex, count) {
    let d = nextIndex - previousIndex;
    if (d > count / 2)
        d -= count;
    if (d < -count / 2)
        d += count;
    return d;
}
export function isForwardLapWrap(previousIndex, nextIndex, count) {
    return previousIndex > count * 0.78 && nextIndex < count * 0.22 && progressDelta(previousIndex, nextIndex, count) > 0;
}
export function signedCircularT(t, center) {
    return circularDiff(t, center);
}
