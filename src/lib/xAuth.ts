import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { redisDelete, redisGetJson, redisSetJson, upstashConfigured } from "@/lib/upstash";

const SESSION_COOKIE = "orbs_x_session";
const OAUTH_TTL_SECONDS = 10 * 60;
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 35;

export type XProfile = {
  id: string;
  username: string;
  name: string;
  profileImageUrl?: string;
  protected: boolean;
};

type XStoredSession = {
  user: XProfile;
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  scope: string;
};

type OAuthState = {
  verifier: string;
  returnTo: string;
  createdAt: number;
};

type TokenPayload = {
  token_type: string;
  expires_in: number;
  access_token: string;
  scope: string;
  refresh_token?: string;
};

function siteUrl() {
  const configured = (process.env.NEXT_PUBLIC_SITE_URL || process.env.SITE_URL || "").trim();
  if (configured) return configured.replace(/\/+$/, "");
  const vercel = (process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL || "").trim();
  return vercel ? `https://${vercel.replace(/^https?:\/\//, "").replace(/\/+$/, "")}` : "http://localhost:3000";
}

export function xRedirectUri() {
  return (process.env.X_REDIRECT_URI || `${siteUrl()}/api/x/callback`).trim();
}

function clientId() { return (process.env.X_CLIENT_ID || "").trim(); }
function clientSecret() { return (process.env.X_CLIENT_SECRET || "").trim(); }
function encryptionSecret() { return (process.env.ORBS_X_TOKEN_ENCRYPTION_KEY || "").trim(); }

export function xConfigured() {
  return Boolean(clientId() && clientSecret() && encryptionSecret() && upstashConfigured());
}

function encryptionKey() {
  const secret = encryptionSecret();
  if (secret.length < 24) throw new Error("ORBS_X_TOKEN_ENCRYPTION_KEY must be a long random secret");
  return createHash("sha256").update(secret).digest();
}

function encrypt(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64url");
}

function decrypt(value: string) {
  const raw = Buffer.from(value, "base64url");
  if (raw.length < 29) throw new Error("Invalid encrypted X token");
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const encrypted = raw.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

const oauthKey = (state: string) => `orbs:v1:x:oauth:${state}`;
const sessionKey = (id: string) => `orbs:v1:x:session:${id}`;

function safeReturnTo(value: string | null | undefined) {
  const path = String(value || "/").trim();
  return path.startsWith("/") && !path.startsWith("//") ? path.slice(0, 500) : "/";
}

function codeChallenge(verifier: string) {
  return createHash("sha256").update(verifier).digest("base64url");
}

function basicAuth() {
  return `Basic ${Buffer.from(`${clientId()}:${clientSecret()}`).toString("base64")}`;
}

async function tokenRequest(params: URLSearchParams): Promise<TokenPayload> {
  const response = await fetch("https://api.x.com/2/oauth2/token", {
    method: "POST",
    headers: {
      Authorization: basicAuth(),
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: params.toString(),
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  });
  const json = parseXPayload<TokenPayload & { error?: string; error_description?: string }>(await response.text());
  if (!response.ok || !json?.access_token) throw new Error(json?.error_description || json?.error || `X token exchange failed (${response.status})`);
  return json;
}

export async function createXAuthorizeUrl(returnTo?: string | null) {
  if (!xConfigured()) throw new Error("X OAuth is not configured");
  const state = randomBytes(24).toString("base64url");
  const verifier = randomBytes(48).toString("base64url");
  const stored: OAuthState = { verifier, returnTo: safeReturnTo(returnTo), createdAt: Date.now() };
  await redisSetJson(oauthKey(state), stored, { exSeconds: OAUTH_TTL_SECONDS });

  const url = new URL("https://x.com/i/oauth2/authorize");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId());
  url.searchParams.set("redirect_uri", xRedirectUri());
  // follows.write lets Orbs perform the user's explicit Follow Host action directly and cheaply.
  url.searchParams.set("scope", "tweet.read users.read follows.write offline.access");
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", codeChallenge(verifier));
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

export async function finishXOAuth(state: string, code: string) {
  if (!xConfigured()) throw new Error("X OAuth is not configured");
  const pending = await redisGetJson<OAuthState>(oauthKey(state));
  if (!pending) throw new Error("X OAuth state expired or is invalid");
  await redisDelete(oauthKey(state));

  const token = await tokenRequest(new URLSearchParams({
    code,
    grant_type: "authorization_code",
    redirect_uri: xRedirectUri(),
    code_verifier: pending.verifier,
  }));

  const meResponse = await fetch("https://api.x.com/2/users/me?user.fields=profile_image_url,protected", {
    headers: { Authorization: `Bearer ${token.access_token}` },
    cache: "no-store",
  });
  const me = await meResponse.json() as { data?: { id?: string; username?: string; name?: string; profile_image_url?: string; protected?: boolean }; error?: string; detail?: string };
  if (!meResponse.ok || !me.data?.id || !me.data.username) throw new Error(me.detail || me.error || "Could not read X profile");

  const sessionId = randomBytes(32).toString("base64url");
  const stored: XStoredSession = {
    user: {
      id: me.data.id,
      username: me.data.username,
      name: me.data.name || me.data.username,
      profileImageUrl: me.data.profile_image_url,
      protected: Boolean(me.data.protected),
    },
    accessToken: encrypt(token.access_token),
    refreshToken: token.refresh_token ? encrypt(token.refresh_token) : undefined,
    expiresAt: Date.now() + Math.max(60, Number(token.expires_in || 7200)) * 1000,
    scope: token.scope || "",
  };
  await redisSetJson(sessionKey(sessionId), stored, { exSeconds: SESSION_TTL_SECONDS });
  return { sessionId, returnTo: pending.returnTo, profile: stored.user };
}

async function refreshSession(sessionId: string, stored: XStoredSession) {
  if (!stored.refreshToken) return stored;
  const token = await tokenRequest(new URLSearchParams({
    refresh_token: decrypt(stored.refreshToken),
    grant_type: "refresh_token",
  }));
  const refreshed: XStoredSession = {
    ...stored,
    accessToken: encrypt(token.access_token),
    refreshToken: token.refresh_token ? encrypt(token.refresh_token) : stored.refreshToken,
    expiresAt: Date.now() + Math.max(60, Number(token.expires_in || 7200)) * 1000,
    scope: token.scope || stored.scope,
  };
  await redisSetJson(sessionKey(sessionId), refreshed, { exSeconds: SESSION_TTL_SECONDS });
  return refreshed;
}

export async function getCurrentXSession(): Promise<{ id: string; user: XProfile; accessToken: string } | null> {
  if (!xConfigured()) return null;
  const jar = await cookies();
  const id = jar.get(SESSION_COOKIE)?.value;
  if (!id || !/^[A-Za-z0-9_-]{30,100}$/.test(id)) return null;
  let stored = await redisGetJson<XStoredSession>(sessionKey(id));
  if (!stored) return null;
  if (stored.expiresAt < Date.now() + 90_000 && stored.refreshToken) {
    try { stored = await refreshSession(id, stored); } catch { return null; }
  }
  return { id, user: stored.user, accessToken: decrypt(stored.accessToken) };
}

export type XRecentPost = {
  id: string;
  text: string;
  createdAt: number;
  urls: string[];
};

export class XApiRequestError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly upstreamStatus: number | null,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "XApiRequestError";
  }
}

type XErrorPayload = {
  detail?: string;
  title?: string;
  type?: string;
  errors?: Array<{ detail?: string; message?: string; title?: string; type?: string }>;
};

function parseXPayload<T>(raw: string): T | null {
  if (!raw) return null;
  try { return JSON.parse(raw) as T; } catch { return null; }
}

function retryAfterSeconds(response: Response) {
  const direct = Number(response.headers.get("retry-after") || "");
  if (Number.isFinite(direct) && direct > 0) return Math.min(900, Math.ceil(direct));
  const reset = Number(response.headers.get("x-rate-limit-reset") || "");
  if (Number.isFinite(reset) && reset > 0) return Math.min(900, Math.max(1, Math.ceil(reset - Date.now() / 1000)));
  return undefined;
}

function recentPostsError(response: Response, payload: XErrorPayload | null) {
  const upstreamDetail = payload?.detail || payload?.errors?.[0]?.detail || payload?.errors?.[0]?.message || payload?.title || "No JSON error body";
  console.warn("[orbs:x:recent-posts] X API request failed", {
    status: response.status,
    detail: upstreamDetail.slice(0, 240),
  });
  if (response.status === 401) {
    return new XApiRequestError("Your X connection expired. Reconnect X, then try verification again.", "X_RECONNECT_REQUIRED", 401);
  }
  if (response.status === 402) {
    return new XApiRequestError("Post verification is temporarily unavailable because the Orbs X API needs active usage credits.", "X_API_CREDITS_REQUIRED", 402);
  }
  if (response.status === 403) {
    return new XApiRequestError("X denied access to recent posts. Reconnect X; if this continues, the Orbs X app needs tweet.read access and active API billing.", "X_POST_READ_FORBIDDEN", 403);
  }
  if (response.status === 429) {
    return new XApiRequestError("X is temporarily rate-limiting post verification. Wait a moment, then try again.", "X_RATE_LIMITED", 429, retryAfterSeconds(response));
  }
  return new XApiRequestError("X is temporarily unavailable for post verification. Your post is safe; wait a moment, then try again.", "X_POST_READ_UNAVAILABLE", response.status || null, 15);
}

export async function getRecentXPostsForCurrentSession(maxResults = 5): Promise<{ user: XProfile; posts: XRecentPost[] }> {
  const session = await getCurrentXSession();
  if (!session) throw new Error("X_NOT_CONNECTED");
  const url = new URL(`https://api.x.com/2/users/${session.user.id}/tweets`);
  url.searchParams.set("max_results", String(Math.max(5, Math.min(10, maxResults))));
  url.searchParams.set("tweet.fields", "created_at,entities");
  url.searchParams.set("exclude", "retweets,replies");
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Authorization: `Bearer ${session.accessToken}`, Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    throw new XApiRequestError(
      timedOut ? "X took too long to verify the post. Your post is safe; wait a moment, then try again." : "Could not reach X for post verification. Wait a moment, then try again.",
      timedOut ? "X_POST_READ_TIMEOUT" : "X_POST_READ_NETWORK_ERROR",
      null,
      15,
    );
  }
  const raw = await response.text();
  const json = parseXPayload<{
    data?: Array<{
      id?: string;
      text?: string;
      created_at?: string;
      entities?: { urls?: Array<{ expanded_url?: string; unwound_url?: string; url?: string }> };
    }>;
    detail?: string;
    title?: string;
    errors?: XErrorPayload["errors"];
  }>(raw);
  if (!response.ok) throw recentPostsError(response, json);
  if (!json) throw new XApiRequestError("X returned an unreadable verification response. Wait a moment, then try again.", "X_POST_READ_INVALID_RESPONSE", response.status, 15);
  const posts = (json.data || []).flatMap((post): XRecentPost[] => {
    const createdAt = Date.parse(post.created_at || "");
    if (!post.id || !Number.isFinite(createdAt)) return [];
    const urls = (post.entities?.urls || []).flatMap((entry) => {
      const value = entry.unwound_url || entry.expanded_url || entry.url;
      return value ? [value] : [];
    });
    return [{ id: post.id, text: post.text || "", createdAt, urls }];
  });
  return { user: session.user, posts };
}

export async function getXPostByIdForCurrentSession(postId: string): Promise<{ user: XProfile; post: XRecentPost; authorId: string }> {
  const session = await getCurrentXSession();
  if (!session) throw new Error("X_NOT_CONNECTED");
  if (!/^\d{5,30}$/.test(postId)) throw new XApiRequestError("That X post link is not valid.", "X_POST_ID_INVALID", null);

  const url = new URL(`https://api.x.com/2/tweets/${postId}`);
  url.searchParams.set("tweet.fields", "author_id,created_at,entities");

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Authorization: `Bearer ${session.accessToken}`, Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    throw new XApiRequestError(
      timedOut ? "X took too long to verify that post link. Wait a moment, then try again." : "Could not reach X for direct post verification. Try again in a moment.",
      timedOut ? "X_POST_READ_TIMEOUT" : "X_POST_READ_NETWORK_ERROR",
      null,
      15,
    );
  }

  const raw = await response.text();
  const json = parseXPayload<{
    data?: {
      id?: string;
      author_id?: string;
      text?: string;
      created_at?: string;
      entities?: { urls?: Array<{ expanded_url?: string; unwound_url?: string; url?: string }> };
    };
    detail?: string;
    title?: string;
    errors?: XErrorPayload["errors"];
  }>(raw);

  if (!response.ok) throw recentPostsError(response, json);
  if (!json?.data?.id || !json.data.author_id) {
    throw new XApiRequestError("X could not return that post. Confirm the link is public and try again.", "X_POST_READ_INVALID_RESPONSE", response.status, 15);
  }

  const createdAt = Date.parse(json.data.created_at || "");
  if (!Number.isFinite(createdAt)) {
    throw new XApiRequestError("X returned that post without a valid timestamp. Try again in a moment.", "X_POST_READ_INVALID_RESPONSE", response.status, 15);
  }
  const urls = (json.data.entities?.urls || []).flatMap((entry) => {
    const value = entry.unwound_url || entry.expanded_url || entry.url;
    return value ? [value] : [];
  });

  return {
    user: session.user,
    authorId: json.data.author_id,
    post: { id: json.data.id, text: json.data.text || "", createdAt, urls },
  };
}


export async function setXSessionCookie(sessionId: string) {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, sessionId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

export async function clearXSession() {
  const jar = await cookies();
  const id = jar.get(SESSION_COOKIE)?.value;
  if (id) await redisDelete(sessionKey(id));
  jar.set(SESSION_COOKIE, "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 0 });
}

export async function followXUser(targetUserId: string) {
  const session = await getCurrentXSession();
  if (!session) throw new Error("X_NOT_CONNECTED");
  if (!/^\d{1,19}$/.test(targetUserId)) throw new Error("INVALID_X_USER");
  if (session.user.id === targetUserId) return { following: true, pending: false, profile: session.user };

  const response = await fetch(`https://api.x.com/2/users/${session.user.id}/following`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${session.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ target_user_id: targetUserId }),
    cache: "no-store",
  });
  const json = await response.json() as { data?: { following?: boolean; pending_follow?: boolean }; detail?: string; title?: string };
  if (!response.ok) throw new Error(json.detail || json.title || `X follow failed (${response.status})`);
  return { following: Boolean(json.data?.following), pending: Boolean(json.data?.pending_follow), profile: session.user };
}

export async function revokeCurrentXSession() {
  const session = await getCurrentXSession();
  if (session) {
    try {
      await fetch("https://api.x.com/2/oauth2/revoke", {
        method: "POST",
        headers: { Authorization: basicAuth(), "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: session.accessToken }).toString(),
        cache: "no-store",
      });
    } catch {}
  }
  await clearXSession();
}
