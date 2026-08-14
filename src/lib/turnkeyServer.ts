import "server-only";

import { Turnkey } from "@turnkey/sdk-server";
import { TurnkeySigner } from "@turnkey/solana";
import { PublicKey, Transaction } from "@solana/web3.js";
import { turnkeyClaimAddress } from "@/lib/orbsProgram";

function required(name: string) {
  const value = (process.env[name] || "").trim();
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

let cachedSigner: TurnkeySigner | null = null;

function signer() {
  if (cachedSigner) return cachedSigner;
  const organizationId = required("TURNKEY_ORGANIZATION_ID");
  // Require the key ID as an operational guard even though the Solana signer uses
  // the public address as `signWith`; Turnkey supports signing by address.
  required("TURNKEY_CLAIM_PRIVATE_KEY_ID");
  const client = new Turnkey({
    apiBaseUrl: "https://api.turnkey.com",
    defaultOrganizationId: organizationId,
    apiPublicKey: required("TURNKEY_API_PUBLIC_KEY"),
    apiPrivateKey: required("TURNKEY_API_PRIVATE_KEY"),
  }).apiClient();
  cachedSigner = new TurnkeySigner({ organizationId, client });
  return cachedSigner;
}

export async function signOrbsClaimTransaction(transaction: Transaction) {
  const address = turnkeyClaimAddress();
  const signed = await signer().signTransaction(transaction, address.toBase58());
  if ("version" in signed) throw new Error("Turnkey returned an unexpected versioned transaction");
  const legacy = signed as Transaction;
  const signature = legacy.signatures.find((entry) => entry.publicKey.equals(address));
  if (!signature?.signature) throw new Error("Turnkey did not attach the configured claim-authority signature");
  if (!legacy.verifySignatures(false)) throw new Error("Turnkey returned a transaction with an invalid existing signature");
  return legacy;
}

export function validateTurnkeyClaimAddress() {
  return new PublicKey(required("TURNKEY_CLAIM_ADDRESS"));
}
