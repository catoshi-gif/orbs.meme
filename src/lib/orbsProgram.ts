import "server-only";

import { createHash } from "node:crypto";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  type AccountMeta,
} from "@solana/web3.js";
import { ORB_COMPETITION_WINDOW_MS } from "@/lib/orbLifecycle";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  CLASSIC_SPL_TOKEN_PROGRAM_ID,
  ORBS_RENT_RECEIVER_WALLET,
  ORBS_TREASURY_WALLET,
  deriveClassicAta,
} from "@/lib/solanaAddresses";
import type { OrbRecord } from "@/lib/orbStore";

const CONFIG_SEED = Buffer.from("config");
const ORB_SEED = Buffer.from("orb");
const HOST_POLICY_SEED = Buffer.from("host-policy");
const CREATE_DISCRIMINATOR = createHash("sha256").update("global:create_and_fund_orb").digest().subarray(0, 8);

export function orbsProgramId() {
  const raw = (process.env.ORBS_PROGRAM_ID || process.env.NEXT_PUBLIC_ORBS_PROGRAM_ID || "").trim();
  if (!raw) throw new Error("ORBS_PROGRAM_ID is not configured");
  return new PublicKey(raw);
}

export function solanaRpcUrl() {
  const raw = (
    process.env.HELIUS_RPC_URL ||
    process.env.SOLANA_MAINNET_RPC ||
    process.env.SOLANA_RPC_URL ||
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL ||
    ""
  ).trim();
  if (!raw) throw new Error("HELIUS_RPC_URL is not configured");
  return raw;
}

function serverKeypair(name: "ORBS_RELAYER_SECRET_KEY" | "ORBS_FEE_QUOTE_AUTHORITY_SECRET_KEY") {
  const raw = (process.env[name] || "").trim();
  if (!raw) throw new Error(`${name} is not configured`);
  let bytes: number[];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed) || parsed.length !== 64 || parsed.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) {
      throw new Error("invalid key bytes");
    }
    bytes = parsed as number[];
  } catch {
    throw new Error(`${name} must be the JSON 64-byte Solana keypair array; base58 private keys are intentionally not accepted`);
  }
  return Keypair.fromSecretKey(Uint8Array.from(bytes));
}

function u64(value: bigint) {
  if (value < BigInt(0) || value > BigInt("18446744073709551615")) throw new Error("u64 value out of range");
  const out = Buffer.alloc(8);
  out.writeBigUInt64LE(value);
  return out;
}

function i64(value: bigint) {
  if (value < -BigInt("9223372036854775808") || value > BigInt("9223372036854775807")) throw new Error("i64 value out of range");
  const out = Buffer.alloc(8);
  out.writeBigInt64LE(value);
  return out;
}

function fixedHex(value: string, bytes: number, label: string) {
  if (!new RegExp(`^[0-9a-fA-F]{${bytes * 2}}$`).test(value)) throw new Error(`Invalid ${label}`);
  return Buffer.from(value, "hex");
}

export function deriveOrbsAccounts(host: PublicKey, orbIdHex: string, mint: PublicKey) {
  const programId = orbsProgramId();
  const orbId = fixedHex(orbIdHex, 16, "Orb id");
  const [config] = PublicKey.findProgramAddressSync([CONFIG_SEED], programId);
  const [orb] = PublicKey.findProgramAddressSync([ORB_SEED, host.toBuffer(), orbId], programId);
  const [hostPolicy] = PublicKey.findProgramAddressSync([HOST_POLICY_SEED, host.toBuffer()], programId);
  const hostTokenAccount = deriveClassicAta(host, mint);
  const prizeVault = deriveClassicAta(orb, mint);
  const treasuryTokenAccount = deriveClassicAta(ORBS_TREASURY_WALLET, mint);
  return { programId, config, orb, hostPolicy, hostTokenAccount, prizeVault, treasuryTokenAccount };
}

function createArgs(record: OrbRecord) {
  const startsAtSeconds = BigInt(Math.floor(record.startsAt / 1000));
  const refundAfterSeconds = startsAtSeconds + BigInt(Math.floor(ORB_COMPETITION_WINDOW_MS / 1000));
  const quoteExpiresAtSeconds = BigInt(Math.floor(record.fundingQuoteExpiresAt / 1000));
  return Buffer.concat([
    fixedHex(record.id, 16, "Orb id"),
    u64(BigInt(record.prizeRawAmount)),
    u64(BigInt(record.prizeUsdMicros)),
    u64(BigInt(record.feeRawAmount)),
    i64(startsAtSeconds),
    i64(refundAfterSeconds),
    i64(quoteExpiresAtSeconds),
    fixedHex(record.commitment, 32, "game commitment"),
  ]);
}

function decodeConfigFeeQuoteAuthority(data: Buffer) {
  // discriminator(8), version(1), bump(1), claim authority(32), fee quote authority(32)
  if (data.length < 74) throw new Error("Orbs protocol config account is malformed");
  return new PublicKey(data.subarray(42, 74));
}

export async function buildCreateAndFundTransaction(record: OrbRecord) {
  if (record.status !== "funding-pending") throw new Error("Orb is not awaiting funding");
  if (record.fundingQuoteExpiresAt <= Date.now()) throw new Error("Funding quote expired; recreate the Orb to obtain a fresh quote");

  const host = new PublicKey(record.hostWallet);
  const mint = new PublicKey(record.token.mint);
  const accounts = deriveOrbsAccounts(host, record.id, mint);
  const payer = serverKeypair("ORBS_RELAYER_SECRET_KEY");
  const feeQuoteAuthority = serverKeypair("ORBS_FEE_QUOTE_AUTHORITY_SECRET_KEY");
  if (!payer.publicKey.equals(ORBS_RENT_RECEIVER_WALLET)) {
    throw new Error("ORBS_RELAYER_SECRET_KEY does not match the hardcoded production rent receiver");
  }

  const connection = new Connection(solanaRpcUrl(), "confirmed");
  const configInfo = await connection.getAccountInfo(accounts.config, "confirmed");
  if (!configInfo || !configInfo.owner.equals(accounts.programId)) {
    throw new Error("Orbs protocol is not initialized at the configured program id");
  }
  const configuredQuoteAuthority = decodeConfigFeeQuoteAuthority(Buffer.from(configInfo.data));
  if (!configuredQuoteAuthority.equals(feeQuoteAuthority.publicKey)) {
    throw new Error("ORBS_FEE_QUOTE_AUTHORITY_SECRET_KEY does not match the protocol config");
  }

  const metas: AccountMeta[] = [
    { pubkey: host, isSigner: true, isWritable: true },
    { pubkey: payer.publicKey, isSigner: true, isWritable: true },
    { pubkey: accounts.config, isSigner: false, isWritable: false },
    { pubkey: feeQuoteAuthority.publicKey, isSigner: true, isWritable: false },
    { pubkey: accounts.orb, isSigner: false, isWritable: true },
    { pubkey: accounts.hostPolicy, isSigner: false, isWritable: true },
    { pubkey: mint, isSigner: false, isWritable: false },
    { pubkey: accounts.hostTokenAccount, isSigner: false, isWritable: true },
    { pubkey: accounts.prizeVault, isSigner: false, isWritable: true },
    { pubkey: ORBS_TREASURY_WALLET, isSigner: false, isWritable: false },
    { pubkey: accounts.treasuryTokenAccount, isSigner: false, isWritable: true },
    { pubkey: CLASSIC_SPL_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];

  const instruction = new TransactionInstruction({
    programId: accounts.programId,
    keys: metas,
    data: Buffer.concat([CREATE_DISCRIMINATOR, createArgs(record)]),
  });
  const latest = await connection.getLatestBlockhash("confirmed");
  const transaction = new Transaction({ feePayer: payer.publicKey, recentBlockhash: latest.blockhash }).add(instruction);
  transaction.partialSign(payer, feeQuoteAuthority);
  const serialized = transaction.serialize({ requireAllSignatures: false, verifySignatures: true });
  return {
    transactionBase64: serialized.toString("base64"),
    blockhash: latest.blockhash,
    lastValidBlockHeight: latest.lastValidBlockHeight,
    orbPda: accounts.orb.toBase58(),
    prizeVault: accounts.prizeVault.toBase58(),
  };
}

type DecodedOrb = {
  version: number;
  orbIdHex: string;
  host: PublicKey;
  mint: PublicKey;
  prizeAmount: bigint;
  feeAmount: bigint;
  prizeUsdMicros: bigint;
  startsAt: bigint;
  refundAfter: bigint;
  gameCommitmentHex: string;
};

function decodeOrbAccount(data: Buffer): DecodedOrb {
  // Anchor discriminator occupies the first 8 bytes.
  if (data.length < 162) throw new Error("On-chain Orb account is malformed");
  let offset = 8;
  const version = data.readUInt8(offset); offset += 1;
  offset += 1; // bump
  const orbIdHex = data.subarray(offset, offset + 16).toString("hex"); offset += 16;
  const host = new PublicKey(data.subarray(offset, offset + 32)); offset += 32;
  const mint = new PublicKey(data.subarray(offset, offset + 32)); offset += 32;
  const prizeAmount = data.readBigUInt64LE(offset); offset += 8;
  const feeAmount = data.readBigUInt64LE(offset); offset += 8;
  const prizeUsdMicros = data.readBigUInt64LE(offset); offset += 8;
  const startsAt = data.readBigInt64LE(offset); offset += 8;
  const refundAfter = data.readBigInt64LE(offset); offset += 8;
  const gameCommitmentHex = data.subarray(offset, offset + 32).toString("hex");
  return { version, orbIdHex, host, mint, prizeAmount, feeAmount, prizeUsdMicros, startsAt, refundAfter, gameCommitmentHex };
}

export async function verifyFundedOrbOnChain(record: OrbRecord, suppliedSignature = "") {
  const host = new PublicKey(record.hostWallet);
  const mint = new PublicKey(record.token.mint);
  const accounts = deriveOrbsAccounts(host, record.id, mint);
  const connection = new Connection(solanaRpcUrl(), "confirmed");

  // The PDA itself is the durable source of truth. This lets the website recover
  // cleanly if the wallet broadcast succeeded but the browser lost the returned
  // transaction signature or the confirmation API call was interrupted.
  const info = await connection.getAccountInfo(accounts.orb, "confirmed");
  if (!info) throw new Error("ORB_NOT_FUNDED");
  if (!info.owner.equals(accounts.programId)) throw new Error("Funded Orb PDA is owned by an unexpected program");
  const decoded = decodeOrbAccount(Buffer.from(info.data));
  const startsAt = BigInt(Math.floor(record.startsAt / 1000));
  const expectedRefund = startsAt + BigInt(Math.floor(ORB_COMPETITION_WINDOW_MS / 1000));
  if (
    decoded.version !== 1 ||
    decoded.orbIdHex !== record.id.toLowerCase() ||
    !decoded.host.equals(host) ||
    !decoded.mint.equals(mint) ||
    decoded.prizeAmount !== BigInt(record.prizeRawAmount) ||
    decoded.feeAmount !== BigInt(record.feeRawAmount) ||
    decoded.prizeUsdMicros !== BigInt(record.prizeUsdMicros) ||
    decoded.startsAt !== startsAt ||
    decoded.refundAfter !== expectedRefund ||
    decoded.gameCommitmentHex !== record.commitment.toLowerCase()
  ) {
    throw new Error("On-chain Orb state does not match the server's sealed game record");
  }
  const vault = await connection.getTokenAccountBalance(accounts.prizeVault, "confirmed");
  if (BigInt(vault.value.amount) < BigInt(record.prizeRawAmount)) throw new Error("On-chain prize vault is underfunded");

  let signature = suppliedSignature.trim();
  if (signature && !/^[1-9A-HJ-NP-Za-km-z]{64,96}$/.test(signature)) throw new Error("Invalid Solana transaction signature");
  if (!signature) {
    const signatures = await connection.getSignaturesForAddress(accounts.orb, { limit: 5 }, "confirmed");
    signature = signatures.find((entry) => !entry.err)?.signature || "";
  }
  if (!signature) throw new Error("Could not recover the Orb funding transaction signature");
  const status = (await connection.getSignatureStatuses([signature], { searchTransactionHistory: true })).value[0];
  if (!status || status.err || !["confirmed", "finalized"].includes(status.confirmationStatus || "")) {
    throw new Error("Funding transaction is not confirmed on Solana");
  }
  return { signature, orbPda: accounts.orb.toBase58(), prizeVault: accounts.prizeVault.toBase58() };
}
