export type UpstashConfig = { url: string; token: string };

export function getUpstashConfig(): UpstashConfig | null {
  const url = (
    process.env.UPSTASH_REDIS_REST_URL ||
    process.env.KV_REST_API_URL ||
    ""
  ).replace(/\/+$/, "");
  const token = (
    process.env.UPSTASH_REDIS_REST_TOKEN ||
    process.env.KV_REST_API_TOKEN ||
    ""
  ).trim();
  return url && token ? { url, token } : null;
}

export function upstashConfigured() {
  return Boolean(getUpstashConfig());
}

export async function redisCommand<T>(parts: Array<string | number>): Promise<T | null> {
  const credentials = getUpstashConfig();
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
  if (!response.ok || payload.error) {
    throw new Error(payload.error || `Upstash request failed (${response.status})`);
  }
  return payload.result ?? null;
}

export async function redisGetJson<T>(key: string): Promise<T | null> {
  const raw = await redisCommand<string>(["GET", key]);
  if (!raw) return null;
  try { return JSON.parse(raw) as T; } catch { return null; }
}

export async function redisSetJson(
  key: string,
  value: unknown,
  options?: { exSeconds?: number; nx?: boolean },
): Promise<boolean> {
  const command: Array<string | number> = ["SET", key, JSON.stringify(value)];
  if (options?.nx) command.push("NX");
  if (options?.exSeconds) command.push("EX", Math.max(1, Math.floor(options.exSeconds)));
  const result = await redisCommand<string>(command);
  return result === "OK";
}

export async function redisDelete(key: string) {
  await redisCommand<number>(["DEL", key]);
}
