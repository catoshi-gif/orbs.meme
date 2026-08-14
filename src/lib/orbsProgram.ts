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
  ORBS_TURNKEY_CLAIM_AUTHORITY_WALLET,
  deriveClassicAta,
} from "@/lib/solanaAddresses";
import type { OrbRecord } from "@/lib/orbStore";

const CONFIG_SEED = Buffer.from("config");
const ORB_SEED = Buffer.from("orb");
const FUND_DISCRIMINATOR = createHash("sha256").update("global:fund_orb").digest().subarray(0, 8);
const CLAIM_DISCRIMINATOR = createHash("sha256").update("global:claim_prize").digest().subarray(0, 8);
const REFUND_DISCRIMINATOR = createHash("sha256").update("global:refund_expired").digest().subarray(0, 8);
const CONFIG_ACCOUNT_DISCRIMINATOR = createHash("sha256").update("account:ProtocolConfig").digest().subarray(0, 8);
const ORB_ACCOUNT_DISCRIMINATOR = createHash("sha256").update("account:Orb").digest().subarray(0, 8);

export function orbsProgramId() {
  const deployed = new PublicKey("464cqCX4vMoQFjeuVinz3R6ccrFz68WqEkSvFSGg7Fns");
  const configured = (process.env.ORBS_PROGRAM_ID || process.env.NEXT_PUBLIC_ORBS_PROGRAM_ID || "").trim();
  if (configured && !new PublicKey(configured).equals(deployed)) throw new Error("Configured Orbs program id does not match the deployed production program");
  return deployed;
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

export function turnkeyClaimAddress() {
  const raw = (process.env.TURNKEY_CLAIM_ADDRESS || "").trim();
  if (!raw) throw new Error("TURNKEY_CLAIM_ADDRESS is not configured");
  const configured = new PublicKey(raw);
  if (!configured.equals(ORBS_TURNKEY_CLAIM_AUTHORITY_WALLET)) throw new Error("TURNKEY_CLAIM_ADDRESS does not match the initialized production claim authority");
  return configured;
}

function serverRelayerKeypair() {
  const raw = (process.env.ORBS_RELAYER_SECRET_KEY || "").trim();
  if (!raw) throw new Error("ORBS_RELAYER_SECRET_KEY is not configured");
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed) || parsed.length !== 64 || parsed.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) {
      throw new Error("invalid key bytes");
    }
    const keypair = Keypair.fromSecretKey(Uint8Array.from(parsed as number[]));
    if (!keypair.publicKey.equals(ORBS_RENT_RECEIVER_WALLET)) {
      throw new Error("ORBS_RELAYER_SECRET_KEY does not match the hardcoded production rent receiver");
    }
    return keypair;
  } catch (error) {
    if (error instanceof Error && error.message.includes("hardcoded production rent receiver")) throw error;
    throw new Error("ORBS_RELAYER_SECRET_KEY must be the JSON 64-byte Solana keypair array; base58 private keys are intentionally not accepted");
  }
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
  const hostTokenAccount = deriveClassicAta(host, mint);
  const prizeVault = deriveClassicAta(orb, mint);
  const treasuryTokenAccount = deriveClassicAta(ORBS_TREASURY_WALLET, mint);
  return { programId, config, orb, hostTokenAccount, prizeVault, treasuryTokenAccount };
}

function decodeProtocolConfig(data: Buffer) {
  if (data.length < 41 || !data.subarray(0, 8).equals(CONFIG_ACCOUNT_DISCRIMINATOR)) {
    throw new Error("Orbs protocol config account is malformed");
  }
  return { bump: data.readUInt8(8), claimAuthority: new PublicKey(data.subarray(9, 41)) };
}

async function assertProtocolConfig(connection: Connection, config: PublicKey, programId: PublicKey) {
  const info = await connection.getAccountInfo(config, "confirmed");
  if (!info || !info.owner.equals(programId)) throw new Error("Orbs protocol is not initialized at the configured program id");
  const decoded = decodeProtocolConfig(Buffer.from(info.data));
  const expected = turnkeyClaimAddress();
  if (!decoded.claimAuthority.equals(expected)) {
    throw new Error("TURNKEY_CLAIM_ADDRESS does not match the live Orbs ProtocolConfig");
  }
  return decoded;
}

function createIdempotentAtaInstruction(payer: PublicKey, ata: PublicKey, owner: PublicKey, mint: PublicKey) {
  return new TransactionInstruction({
    programId: ASSOCIATED_TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: ata, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: CLASSIC_SPL_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: Buffer.from([1]),
  });
}

function createTransferCheckedInstruction(source: PublicKey, mint: PublicKey, destination: PublicKey, authority: PublicKey, amount: bigint, decimals: number) {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) throw new Error("Invalid token decimals");
  return new TransactionInstruction({
    programId: CLASSIC_SPL_TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: source, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: destination, isSigner: false, isWritable: true },
      { pubkey: authority, isSigner: true, isWritable: false },
    ],
    data: Buffer.concat([Buffer.from([12]), u64(amount), Buffer.from([decimals])]),
  });
}

function fundArgs(record: OrbRecord) {
  const startsAt = BigInt(Math.floor(record.startsAt / 1000));
  const refundAfter = BigInt(Math.floor((record.endsAt ?? (record.startsAt + ORB_COMPETITION_WINDOW_MS)) / 1000));
  return Buffer.concat([
    fixedHex(record.id, 16, "Orb id"),
    u64(BigInt(record.prizeRawAmount)),
    i64(startsAt),
    i64(refundAfter),
  ]);
}

export async function buildFundingTransaction(record: OrbRecord) {
  if (record.status !== "funding-pending") throw new Error("Orb is not awaiting funding");
  if (record.fundingQuoteExpiresAt <= Date.now()) throw new Error("Funding quote expired; recreate the Orb to obtain a fresh quote");

  const host = new PublicKey(record.hostWallet);
  const mint = new PublicKey(record.token.mint);
  const accounts = deriveOrbsAccounts(host, record.id, mint);
  const payer = serverRelayerKeypair();
  const connection = new Connection(solanaRpcUrl(), "confirmed");
  await assertProtocolConfig(connection, accounts.config, accounts.programId);

  const feeInstruction = createTransferCheckedInstruction(
    accounts.hostTokenAccount,
    mint,
    accounts.treasuryTokenAccount,
    host,
    BigInt(record.feeRawAmount),
    record.token.decimals,
  );

  const fundMetas: AccountMeta[] = [
    { pubkey: host, isSigner: true, isWritable: true },
    { pubkey: payer.publicKey, isSigner: true, isWritable: true },
    { pubkey: accounts.orb, isSigner: false, isWritable: true },
    { pubkey: mint, isSigner: false, isWritable: false },
    { pubkey: accounts.hostTokenAccount, isSigner: false, isWritable: true },
    { pubkey: accounts.prizeVault, isSigner: false, isWritable: true },
    { pubkey: CLASSIC_SPL_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];

  const fundInstruction = new TransactionInstruction({
    programId: accounts.programId,
    keys: fundMetas,
    data: Buffer.concat([FUND_DISCRIMINATOR, fundArgs(record)]),
  });

  const latest = await connection.getLatestBlockhash("confirmed");
  const transaction = new Transaction({ feePayer: payer.publicKey, recentBlockhash: latest.blockhash }).add(
    createIdempotentAtaInstruction(payer.publicKey, accounts.treasuryTokenAccount, ORBS_TREASURY_WALLET, mint),
    feeInstruction,
    fundInstruction,
  );
  transaction.partialSign(payer);

  return {
    transactionBase64: transaction.serialize({ requireAllSignatures: false, verifySignatures: true }).toString("base64"),
    blockhash: latest.blockhash,
    lastValidBlockHeight: latest.lastValidBlockHeight,
    orbPda: accounts.orb.toBase58(),
    prizeVault: accounts.prizeVault.toBase58(),
  };
}

type DecodedOrb = {
  bump: number;
  orbIdHex: string;
  host: PublicKey;
  mint: PublicKey;
  prizeAmount: bigint;
  startsAt: bigint;
  refundAfter: bigint;
};

function decodeOrbAccount(data: Buffer): DecodedOrb {
  if (data.length < 113 || !data.subarray(0, 8).equals(ORB_ACCOUNT_DISCRIMINATOR)) throw new Error("On-chain Orb account is malformed");
  let offset = 8;
  const bump = data.readUInt8(offset); offset += 1;
  const orbIdHex = data.subarray(offset, offset + 16).toString("hex"); offset += 16;
  const host = new PublicKey(data.subarray(offset, offset + 32)); offset += 32;
  const mint = new PublicKey(data.subarray(offset, offset + 32)); offset += 32;
  const prizeAmount = data.readBigUInt64LE(offset); offset += 8;
  const startsAt = data.readBigInt64LE(offset); offset += 8;
  const refundAfter = data.readBigInt64LE(offset);
  return { bump, orbIdHex, host, mint, prizeAmount, startsAt, refundAfter };
}

function assertOrbMatchesRecord(decoded: DecodedOrb, record: OrbRecord, host: PublicKey, mint: PublicKey) {
  const expectedStarts = BigInt(Math.floor(record.startsAt / 1000));
  const expectedRefund = BigInt(Math.floor((record.endsAt ?? (record.startsAt + ORB_COMPETITION_WINDOW_MS)) / 1000));
  if (decoded.orbIdHex.toLowerCase() !== record.id.toLowerCase()) throw new Error("On-chain Orb id does not match the sealed funding record");
  if (!decoded.host.equals(host) || !decoded.mint.equals(mint)) throw new Error("On-chain Orb identities do not match the sealed funding record");
  if (decoded.prizeAmount !== BigInt(record.prizeRawAmount)) throw new Error("On-chain prize does not match the sealed funding record");
  if (decoded.startsAt !== expectedStarts || decoded.refundAfter !== expectedRefund) throw new Error("On-chain custody window does not match the sealed funding record");
}

export async function verifyFundedOrbOnChain(record: OrbRecord, suppliedSignature = "") {
  const host = new PublicKey(record.hostWallet);
  const mint = new PublicKey(record.token.mint);
  const accounts = deriveOrbsAccounts(host, record.id, mint);
  const connection = new Connection(solanaRpcUrl(), "confirmed");

  const info = await connection.getAccountInfo(accounts.orb, "confirmed");
  if (!info) throw new Error("ORB_NOT_FUNDED");
  if (!info.owner.equals(accounts.programId)) throw new Error("Orb PDA is owned by an unexpected program");
  const decoded = decodeOrbAccount(Buffer.from(info.data));
  assertOrbMatchesRecord(decoded, record, host, mint);

  const vault = await connection.getTokenAccountBalance(accounts.prizeVault, "confirmed");
  if (BigInt(vault.value.amount) < BigInt(record.prizeRawAmount)) throw new Error("Prize vault is underfunded");

  const signatures = await connection.getSignaturesForAddress(accounts.orb, { limit: 20 }, "confirmed");
  const successful = signatures.filter((entry) => !entry.err);
  if (!successful.length) throw new Error("Funded Orb has no successful creation transaction");
  const requested = suppliedSignature.trim();
  const candidates = requested
    ? successful.filter((entry) => entry.signature === requested)
    : successful;
  if (!candidates.length) throw new Error("Supplied funding signature does not reference this Orb PDA");

  let signature = "";
  for (const candidate of candidates) {
    const parsed = await connection.getParsedTransaction(candidate.signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
    if (!parsed || parsed.meta?.err) continue;
    const referencesProgram = parsed.transaction.message.instructions.some((ix) => "programId" in ix && ix.programId.equals(accounts.programId));
    if (!referencesProgram) continue;
    signature = candidate.signature;
    break;
  }
  if (!signature) throw new Error("Funding transaction does not invoke the Orbs program");

  return { signature, orbPda: accounts.orb.toBase58(), prizeVault: accounts.prizeVault.toBase58() };
}

export async function loadVerifiedOrbState(record: OrbRecord) {
  const host = new PublicKey(record.hostWallet);
  const mint = new PublicKey(record.token.mint);
  const accounts = deriveOrbsAccounts(host, record.id, mint);
  const connection = new Connection(solanaRpcUrl(), "confirmed");
  await assertProtocolConfig(connection, accounts.config, accounts.programId);
  const info = await connection.getAccountInfo(accounts.orb, "confirmed");
  if (!info) throw new Error("Orb escrow account is closed");
  if (!info.owner.equals(accounts.programId)) throw new Error("Orb PDA is owned by an unexpected program");
  const decoded = decodeOrbAccount(Buffer.from(info.data));
  assertOrbMatchesRecord(decoded, record, host, mint);
  return { connection, host, mint, accounts, decoded };
}

export function buildClaimInstruction(record: OrbRecord, winner: PublicKey, payer: PublicKey) {
  const host = new PublicKey(record.hostWallet);
  const mint = new PublicKey(record.token.mint);
  const accounts = deriveOrbsAccounts(host, record.id, mint);
  const claimAuthority = turnkeyClaimAddress();
  const winnerTokenAccount = deriveClassicAta(winner, mint);
  const keys: AccountMeta[] = [
    { pubkey: payer, isSigner: true, isWritable: true },
    { pubkey: ORBS_RENT_RECEIVER_WALLET, isSigner: false, isWritable: true },
    { pubkey: accounts.config, isSigner: false, isWritable: false },
    { pubkey: claimAuthority, isSigner: true, isWritable: false },
    { pubkey: accounts.orb, isSigner: false, isWritable: true },
    { pubkey: mint, isSigner: false, isWritable: false },
    { pubkey: accounts.prizeVault, isSigner: false, isWritable: true },
    { pubkey: winner, isSigner: true, isWritable: false },
    { pubkey: winnerTokenAccount, isSigner: false, isWritable: true },
    { pubkey: CLASSIC_SPL_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];
  return {
    instruction: new TransactionInstruction({ programId: accounts.programId, keys, data: CLAIM_DISCRIMINATOR }),
    accounts,
    winnerTokenAccount,
    claimAuthority,
  };
}

export async function buildRefundTransaction(record: OrbRecord) {
  if (Date.now() < (record.endsAt ?? record.startsAt + ORB_COMPETITION_WINDOW_MS)) throw new Error("Orb has not reached its refund time");
  const { connection, host, mint, accounts } = await loadVerifiedOrbState(record);
  const payer = serverRelayerKeypair();
  const hostTokenAccount = deriveClassicAta(host, mint);
  const keys: AccountMeta[] = [
    { pubkey: payer.publicKey, isSigner: true, isWritable: true },
    { pubkey: ORBS_RENT_RECEIVER_WALLET, isSigner: false, isWritable: true },
    { pubkey: accounts.orb, isSigner: false, isWritable: true },
    { pubkey: mint, isSigner: false, isWritable: false },
    { pubkey: accounts.prizeVault, isSigner: false, isWritable: true },
    { pubkey: host, isSigner: false, isWritable: false },
    { pubkey: hostTokenAccount, isSigner: false, isWritable: true },
    { pubkey: CLASSIC_SPL_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];
  const latest = await connection.getLatestBlockhash("confirmed");
  const tx = new Transaction({ feePayer: payer.publicKey, recentBlockhash: latest.blockhash }).add(
    new TransactionInstruction({ programId: accounts.programId, keys, data: REFUND_DISCRIMINATOR }),
  );
  tx.partialSign(payer);
  return { connection, tx, latest, accounts };
}


export async function verifyClaimedOrbOnChain(record: OrbRecord, winner: PublicKey, signature: string) {
  const host = new PublicKey(record.hostWallet);
  const mint = new PublicKey(record.token.mint);
  const accounts = deriveOrbsAccounts(host, record.id, mint);
  const claimAuthority = turnkeyClaimAddress();
  const winnerAta = deriveClassicAta(winner, mint);
  const connection = new Connection(solanaRpcUrl(), "confirmed");
  const parsed = await connection.getParsedTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
  if (!parsed || parsed.meta?.err) throw new Error("Claim transaction is not confirmed successfully");
  if (parsed.transaction.message.instructions.length !== 1) throw new Error("Claim transaction contains unexpected top-level instructions");
  const ix = parsed.transaction.message.instructions[0]!;
  if (!("programId" in ix) || !ix.programId.equals(accounts.programId) || !("accounts" in ix)) throw new Error("Claim transaction does not invoke claim_prize");
  const expected = [
    ORBS_RENT_RECEIVER_WALLET, ORBS_RENT_RECEIVER_WALLET, accounts.config, claimAuthority,
    accounts.orb, mint, accounts.prizeVault, winner, winnerAta, CLASSIC_SPL_TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID, SystemProgram.programId,
  ];
  if (ix.accounts.length !== expected.length || ix.accounts.some((key, index) => !key.equals(expected[index]!))) {
    throw new Error("Claim transaction account layout does not match this Orb and winner");
  }
  const [orbInfo, vaultInfo] = await Promise.all([
    connection.getAccountInfo(accounts.orb, "confirmed"),
    connection.getAccountInfo(accounts.prizeVault, "confirmed"),
  ]);
  if (orbInfo || vaultInfo) throw new Error("Claim did not close the Orb custody accounts");
  return { orbPda: accounts.orb.toBase58(), prizeVault: accounts.prizeVault.toBase58() };
}

export async function verifySettledOrbClosed(record: OrbRecord, signature: string) {
  const host = new PublicKey(record.hostWallet);
  const mint = new PublicKey(record.token.mint);
  const accounts = deriveOrbsAccounts(host, record.id, mint);
  const connection = new Connection(solanaRpcUrl(), "confirmed");
  const status = await connection.getSignatureStatus(signature, { searchTransactionHistory: true });
  if (!status.value || status.value.err) throw new Error("Settlement transaction is not confirmed successfully");
  const [orbInfo, vaultInfo] = await Promise.all([
    connection.getAccountInfo(accounts.orb, "confirmed"),
    connection.getAccountInfo(accounts.prizeVault, "confirmed"),
  ]);
  if (orbInfo || vaultInfo) throw new Error("Settlement did not close the Orb custody accounts");
  return { orbPda: accounts.orb.toBase58(), prizeVault: accounts.prizeVault.toBase58() };
}
