import "server-only";

import { getOrbRecord, recordHostSharePost } from "@/lib/orbStore";
import { redisCommand } from "@/lib/upstash";
import { getAllDurableOrbAnalytics } from "@/lib/durableAnalytics";

type PublicMetrics = {
  impression_count?: number;
  like_count?: number;
  retweet_count?: number;
  reply_count?: number;
  quote_count?: number;
};

type XPost = {
  id: string;
  author_id?: string;
  created_at?: string;
  public_metrics?: PublicMetrics;
};

const metricKey = (postId: string) => `orbs:v1:admin:xmetrics:${postId}`;

function bearer() {
  const value = (process.env.X_BEARER_TOKEN || "").trim();
  if (!value) throw new Error("X_BEARER_TOKEN is not configured. Add the App Bearer Token from the X Developer Console to enable manual reach refresh.");
  return value;
}

function normalizeMetrics(post: XPost) {
  const m = post.public_metrics || {};
  return {
    postId: post.id,
    impressions: Number(m.impression_count || 0),
    likes: Number(m.like_count || 0),
    reposts: Number(m.retweet_count || 0),
    replies: Number(m.reply_count || 0),
    quotes: Number(m.quote_count || 0),
    refreshedAt: Date.now(),
  };
}

async function xFetch(url: string) {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${bearer()}`, Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  const raw = await response.text();
  let json: any = null;
  try { json = raw ? JSON.parse(raw) : null; } catch {}
  if (!response.ok) {
    const detail = json?.detail || json?.title || json?.errors?.[0]?.detail || `X API request failed (${response.status})`;
    throw new Error(detail);
  }
  return json;
}

export async function fetchOnePublicPost(postId: string) {
  if (!/^\d{5,25}$/.test(postId)) throw new Error("Invalid X post ID");
  const url = new URL(`https://api.x.com/2/tweets/${postId}`);
  url.searchParams.set("tweet.fields", "public_metrics,author_id,created_at");
  const json = await xFetch(url.toString());
  if (!json?.data?.id) throw new Error("X post was not found");
  return json.data as XPost;
}

export async function attachHostPostForAdmin(slug: string, postId: string) {
  const orb = await getOrbRecord(slug);
  if (!orb) throw new Error("Orb not found");
  if (orb.status === "funding-pending") throw new Error("Only funded Orbs can have a host analytics post");
  const post = await fetchOnePublicPost(postId);
  if (post.author_id !== orb.hostX.id) throw new Error("That X post was not authored by this Orb's host account");
  const createdAt = post.created_at ? Date.parse(post.created_at) : Date.now();
  await recordHostSharePost(slug, orb.hostX.id, post.id, Number.isFinite(createdAt) ? createdAt : Date.now());
  const metrics = normalizeMetrics(post);
  await redisCommand<string>(["SET", metricKey(post.id), JSON.stringify(metrics)]);
  return metrics;
}

export async function refreshAllHostPostMetrics() {
  const durable = await getAllDurableOrbAnalytics();
  const ids = [...new Set(durable.map((r) => r.hostSharePostId).filter((id): id is string => Boolean(id)))];
  if (!ids.length) return { postsRead: 0, estimatedCostUsd: 0, totalImpressions: 0 };

  let totalImpressions = 0;
  let postsRead = 0;
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const url = new URL("https://api.x.com/2/tweets");
    url.searchParams.set("ids", chunk.join(","));
    url.searchParams.set("tweet.fields", "public_metrics,author_id,created_at");
    const json = await xFetch(url.toString());
    const posts = Array.isArray(json?.data) ? json.data as XPost[] : [];
    for (const post of posts) {
      const metrics = normalizeMetrics(post);
      totalImpressions += metrics.impressions;
      postsRead += 1;
      await redisCommand<string>(["SET", metricKey(post.id), JSON.stringify(metrics)]);
    }
  }
  return { postsRead, estimatedCostUsd: postsRead * 0.005, totalImpressions };
}

export function parseXPostId(value: string) {
  const trimmed = value.trim();
  if (/^\d{5,25}$/.test(trimmed)) return trimmed;
  try {
    const url = new URL(trimmed);
    const match = url.pathname.match(/\/status\/(\d{5,25})/);
    return match?.[1] || null;
  } catch {
    return null;
  }
}
