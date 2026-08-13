export type WinnerRecord = {
  slug: string;
  replayId: string;
  manifestHash: string;
  replayHash: string;
  verifiedElapsedMs: number;
  verifiedAt: string;
};

export type WinnerLockResult =
  | { configured: false; acquired: true; record: WinnerRecord }
  | { configured: true; acquired: true; record: WinnerRecord }
  | { configured: true; acquired: false; record: WinnerRecord | null };

function config() {
  const url = process.env.UPSTASH_REDIS_REST_URL?.replace(/\/+$/, "");
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url, token } : null;
}

async function command<T>(parts: Array<string | number>): Promise<T | null> {
  const credentials = config();
  if (!credentials) return null;
  const response = await fetch(credentials.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${credentials.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(parts),
    cache: "no-store",
  });
  const payload = await response.json() as { result?: T; error?: string };
  if (!response.ok || payload.error) throw new Error(payload.error || `Upstash request failed (${response.status})`);
  return payload.result ?? null;
}

function winnerKey(slug: string) {
  return `orbs:v1:winner:${slug}`;
}

/**
 * Atomic first-winner lock. Redis SET NX is itself atomic, so only one verified finish can
 * acquire this key even when multiple Vercel functions race concurrently.
 *
 * Until Upstash credentials are configured, demo/local runs remain verification-only and are
 * treated as acquired so the UI can exercise the entire verifier flow without pretending a
 * durable production winner exists.
 */
export async function tryAcquireWinner(slug: string, record: WinnerRecord): Promise<WinnerLockResult> {
  const credentials = config();
  if (!credentials) return { configured: false, acquired: true, record };

  const ttlSeconds = 60 * 60 * 48;
  const result = await command<string>(["SET", winnerKey(slug), JSON.stringify(record), "NX", "EX", ttlSeconds]);
  if (result === "OK") return { configured: true, acquired: true, record };

  const existing = await getWinner(slug);
  return { configured: true, acquired: false, record: existing };
}

export async function getWinner(slug: string): Promise<WinnerRecord | null> {
  if (!config()) return null;
  const raw = await command<string>(["GET", winnerKey(slug)]);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as WinnerRecord;
  } catch {
    return null;
  }
}

export function winnerStoreConfigured() {
  return Boolean(config());
}
