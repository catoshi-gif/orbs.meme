import "server-only";

import { createPublicKey, randomBytes, verify as verifySignature } from "node:crypto";
import { cookies } from "next/headers";
import { PublicKey } from "@solana/web3.js";
import { redisCommand, redisDelete, redisGetJson, redisSetJson } from "@/lib/upstash";

const ADMIN_COOKIE = "orbs_admin_session";
const challengeKey = (wallet: string) => `orbs:v1:admin-challenge:${wallet}`;
const sessionKey = (id: string) => `orbs:v1:admin-session:${id}`;

export function configuredAdminWallet() {
  const raw = (process.env.ADMIN_WALLET || "").trim();
  if (!raw) return null;
  try { return new PublicKey(raw).toBase58(); } catch { return null; }
}

export async function createAdminChallenge(wallet: string) {
  const configured = configuredAdminWallet();
  if (!configured) throw new Error("ADMIN_WALLET is not configured");
  const normalized = new PublicKey(wallet).toBase58();
  if (normalized !== configured) throw new Error("This wallet is not authorized for Orbs admin");
  const nonce = randomBytes(24).toString("base64url");
  const issuedAt = new Date().toISOString();
  const message = [
    "Orbs admin login",
    `Wallet: ${normalized}`,
    `Nonce: ${nonce}`,
    `Issued: ${issuedAt}`,
    "Authorize access to the private Orbs operator dashboard.",
    "This signature does not authorize a transaction or move funds.",
  ].join("\n");
  const stored = await redisSetJson(challengeKey(normalized), { message, issuedAt }, { exSeconds: 10 * 60 });
  if (!stored) throw new Error("Admin login storage is unavailable");
  return { wallet: normalized, message };
}

export async function verifyAdminChallenge(wallet: string, signatureBase64: string) {
  const configured = configuredAdminWallet();
  const normalized = new PublicKey(wallet).toBase58();
  if (!configured || normalized !== configured) return false;
  const pending = await redisGetJson<{ message: string }>(challengeKey(normalized));
  if (!pending?.message) return false;
  let signature: Buffer;
  try { signature = Buffer.from(signatureBase64, "base64"); } catch { return false; }
  if (signature.length !== 64) return false;
  const spkiPrefix = Buffer.from("302a300506032b6570032100", "hex");
  const key = createPublicKey({
    key: Buffer.concat([spkiPrefix, Buffer.from(new PublicKey(normalized).toBytes())]),
    format: "der",
    type: "spki",
  });
  if (!verifySignature(null, Buffer.from(pending.message, "utf8"), key, signature)) return false;
  await redisDelete(challengeKey(normalized));
  const id = randomBytes(32).toString("base64url");
  const stored = await redisSetJson(sessionKey(id), { wallet: normalized, createdAt: Date.now() }, { exSeconds: 12 * 60 * 60 });
  if (!stored) return false;
  const jar = await cookies();
  jar.set(ADMIN_COOKIE, id, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: 12 * 60 * 60,
  });
  return true;
}

export async function getAdminSession() {
  const configured = configuredAdminWallet();
  if (!configured) return null;
  const jar = await cookies();
  const id = jar.get(ADMIN_COOKIE)?.value || "";
  if (!/^[A-Za-z0-9_-]{30,100}$/.test(id)) return null;
  const session = await redisGetJson<{ wallet: string; createdAt: number }>(sessionKey(id));
  return session?.wallet === configured ? session : null;
}

export async function clearAdminSession() {
  const jar = await cookies();
  const id = jar.get(ADMIN_COOKIE)?.value || "";
  if (id) await redisCommand<number>(["DEL", sessionKey(id)]).catch(() => null);
  jar.delete(ADMIN_COOKIE);
}
