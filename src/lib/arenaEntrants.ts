import { createHash } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import { redisCommand, redisGetJson } from "@/lib/upstash";
import { ORB_HISTORY_TTL_SECONDS } from "@/lib/orbLifecycle";
import type { XProfile } from "@/lib/xAuth";

export type ArenaEntrantProfile = {
  wallet: string;
  xUserId: string;
  username: string;
  profileImageUrl?: string | null;
  orbColor: string;
  updatedAt: number;
};

const profileKey = (slug: string, wallet: string) => `orbs:v1:arena:profile:${slug}:${wallet}`;
const colorsKey = (slug: string) => `orbs:v1:arena:colors:${slug}`;
const HEX = /^#[0-9A-F]{6}$/;
function colorDistance(a:string,b:string){const n=(x:string)=>[parseInt(x.slice(1,3),16),parseInt(x.slice(3,5),16),parseInt(x.slice(5,7),16)];const [ar,ag,ab]=n(a),[br,bg,bb]=n(b);return Math.hypot(ar-br,ag-bg,ab-bb)}

function normalizeWallet(wallet: string) { return new PublicKey(wallet).toBase58(); }
function cleanHex(value: string) { const upper = value.trim().toUpperCase(); return HEX.test(upper) ? upper : null; }
function hslToHex(h: number, s = 90, l = 60) {
  s /= 100; l /= 100;
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c / 2;
  let r=0,g=0,b=0;
  if(h<60){r=c;g=x}else if(h<120){r=x;g=c}else if(h<180){g=c;b=x}else if(h<240){g=x;b=c}else if(h<300){r=x;b=c}else{r=c;b=x}
  const q=(v:number)=>Math.round((v+m)*255).toString(16).padStart(2,"0").toUpperCase();
  return `#${q(r)}${q(g)}${q(b)}`;
}
function palette(seed: string) {
  const start = createHash("sha256").update(seed).digest().readUInt16BE(0) % 360;
  const out: string[] = [];
  for (let i=0;i<120;i++) out.push(hslToHex((start + i * 137.508) % 360, i % 3 === 0 ? 96 : 88, i % 4 === 0 ? 66 : 58));
  return out;
}

export async function getArenaEntrantProfile(slug: string, wallet: string) {
  try { return await redisGetJson<ArenaEntrantProfile>(profileKey(slug, normalizeWallet(wallet))); }
  catch { return null; }
}

export async function assignArenaEntrantProfile(slug: string, walletInput: string, x: XProfile, requestedColor?: string | null) {
  const wallet = normalizeWallet(walletInput);
  const existing = await getArenaEntrantProfile(slug, wallet);
  const used = (await redisCommand<string[]>(["HVALS", colorsKey(slug)]) || []).map((v) => v.toUpperCase());
  const usedByOthers = used.filter((color) => color !== existing?.orbColor?.toUpperCase());
  const distinct = (candidate:string) => usedByOthers.every((usedColor) => colorDistance(candidate, usedColor) >= 34);
  const requested = requestedColor ? cleanHex(requestedColor) : null;
  let color = requested && distinct(requested) ? requested : null;
  if (!color) color = palette(`${slug}:${wallet}:${requested || "auto"}`).find(distinct) || palette(`${slug}:${wallet}:fallback`)[0] || "#72F7FF";
  const profile: ArenaEntrantProfile = {
    wallet,
    xUserId: x.id,
    username: x.username,
    profileImageUrl: x.profileImageUrl || null,
    orbColor: color,
    updatedAt: Date.now(),
  };
  const ttl = Math.max(ORB_HISTORY_TTL_SECONDS, 60 * 60 * 24 * 35);
  const stored = await redisCommand<number>(["EVAL", `
    redis.call('HSET', KEYS[1], ARGV[1], ARGV[2])
    redis.call('EXPIRE', KEYS[1], ARGV[3])
    redis.call('SET', KEYS[2], ARGV[4], 'EX', ARGV[3])
    return 1
  `, "2", colorsKey(slug), profileKey(slug, wallet), wallet, color, String(ttl), JSON.stringify(profile)]);
  if (stored !== 1) throw new Error("Could not save Arena Orb color");
  return profile;
}
