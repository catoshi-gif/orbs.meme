import { getUpstashConfig, redisCommand } from "@/lib/upstash";

export type WinnerRecord = {
  slug: string;
  orbId?: string;
  replayId: string;
  manifestHash: string;
  replayHash: string;
  verifiedElapsedMs: number;
  verifiedAt: string;
  wallet?: string;
  xUserId?: string;
  xUsername?: string;
};

export type WinnerLockResult =
  | { configured: false; acquired: true; record: WinnerRecord }
  | { configured: true; acquired: true; record: WinnerRecord }
  | { configured: true; acquired: false; record: WinnerRecord | null };

function winnerKey(lockId: string) {
  return `orbs:v1:winner:${lockId}`;
}

/** Atomic first-winner lock. Redis SET NX guarantees one winner across concurrent Vercel functions. */
export async function tryAcquireWinner(lockId: string, record: WinnerRecord): Promise<WinnerLockResult> {
  const credentials = getUpstashConfig();
  if (!credentials) return { configured: false, acquired: true, record };

  const ttlSeconds = 60 * 60 * 24 * 30;
  const result = await redisCommand<string>(["SET", winnerKey(lockId), JSON.stringify(record), "NX", "EX", ttlSeconds]);
  if (result === "OK") return { configured: true, acquired: true, record };

  const existing = await getWinner(lockId);
  return { configured: true, acquired: false, record: existing };
}

export async function getWinner(lockId: string): Promise<WinnerRecord | null> {
  if (!getUpstashConfig()) return null;
  const raw = await redisCommand<string>(["GET", winnerKey(lockId)]);
  if (!raw) return null;
  try { return JSON.parse(raw) as WinnerRecord; } catch { return null; }
}

export function winnerStoreConfigured() {
  return Boolean(getUpstashConfig());
}
