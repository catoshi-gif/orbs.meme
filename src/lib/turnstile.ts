import { redisGetJson, redisSetJson, upstashConfigured } from "@/lib/upstash";

const TURNSTILE_ACTION = "orb-qualify";
export const humanProofKey = (slug: string, xUserId: string, wallet: string) => `orbs:v1:humanproof:${slug}:${xUserId}:${wallet}`;

export function turnstileConfigured() {
  return Boolean((process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || "").trim() && (process.env.TURNSTILE_SECRET_KEY || "").trim() && upstashConfigured());
}

export async function hasHumanProof(slug: string, xUserId: string, wallet: string) {
  return Boolean(await redisGetJson<{ verifiedAt: number }>(humanProofKey(slug, xUserId, wallet)));
}

export async function verifyAndStoreHumanProof(input: { slug: string; xUserId: string; wallet: string; token: string; remoteIp?: string | null }) {
  const secret = (process.env.TURNSTILE_SECRET_KEY || "").trim();
  if (!secret || !upstashConfigured()) throw new Error("TURNSTILE_NOT_CONFIGURED");
  if (!input.token || input.token.length > 2048) return false;

  const form = new URLSearchParams({ secret, response: input.token });
  if (input.remoteIp) form.set("remoteip", input.remoteIp);
  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
    cache: "no-store",
  });
  const result = await response.json() as { success?: boolean; action?: string; hostname?: string; "error-codes"?: string[] };
  if (!response.ok || !result.success || result.action !== TURNSTILE_ACTION) return false;

  await redisSetJson(humanProofKey(input.slug, input.xUserId, input.wallet), {
    verifiedAt: Date.now(),
    hostname: result.hostname || null,
  }, { exSeconds: 60 * 60 * 12 });
  return true;
}

export const TURNSTILE_QUALIFY_ACTION = TURNSTILE_ACTION;
