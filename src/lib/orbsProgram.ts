import "server-only";

import { createHash } from "node:crypto";
import bs58 from "bs58";
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
  WRAPPED_SOL_MINT,
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

export function serverRelayerKeypair() {
  const raw = (process.env.ORBS_RELAYER_SECRET_KEY || "").trim();
  if (!raw) throw new Error("ORBS_RELAYER_SECRET_KEY is not configured");

  let secretBytes: Uint8Array;
  try {
    if (raw.startsWith("[")) {
      const parsed = JSON.parse(raw) as unknown;
      if (
        !Array.isArray(parsed) ||
        parsed.length !== 64 ||
        parsed.some((value) => !Number.isInteger(value) || value < 0 || value > 255)
      ) {
        throw new Error("invalid JSON key bytes");
      }
      secretBytes = Uint8Array.from(parsed as number[]);
    } else {
      secretBytes = bs58.decode(raw);
    }
  } catch {
    throw new Error(
      "ORBS_RELAYER_SECRET_KEY must be either a Base58 Solana private key or a JSON 64-byte keypair array",
    );
  }

  let keypair: Keypair;
  if (secretBytes.length === 64) {
    keypair = Keypair.fromSecretKey(secretBytes);
  } else if (secretBytes.length === 32) {
    keypair = Keypair.fromSeed(secretBytes);
  } else {
    throw new Error(
      `ORBS_RELAYER_SECRET_KEY decoded to ${secretBytes.length} bytes; expected a 64-byte Solana secret key or 32-byte seed`,
    );
  }

  if (!keypair.publicKey.equals(ORBS_RENT_RECEIVER_WALLET)) {
    throw new Error(
      "ORBS_RELAYER_SECRET_KEY does not match the hardcoded production rent receiver",
    );
  }

  return keypair;
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

function createSyncNativeInstruction(account: PublicKey) {
  return new TransactionInstruction({
    programId: CLASSIC_SPL_TOKEN_PROGRAM_ID,
    keys: [{ pubkey: account, isSigner: false, isWritable: true }],
    data: Buffer.from([17]),
  });
}

function createCloseTokenAccountInstruction(account: PublicKey, destination: PublicKey, authority: PublicKey) {
  return new TransactionInstruction({
    programId: CLASSIC_SPL_TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: account, isSigner: false, isWritable: true },
      { pubkey: destination, isSigner: false, isWritable: true },
      { pubkey: authority, isSigner: true, isWritable: false },
    ],
    data: Buffer.from([9]),
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
  const transaction = new Transaction({ feePayer: payer.publicKey, recentBlockhash: latest.blockhash });
  if (record.token.isNativeSol === true) {
    if (!mint.equals(WRAPPED_SOL_MINT) || record.token.decimals !== 9) throw new Error("Native SOL funding record is malformed");
    const wrapLamports = BigInt(record.prizeRawAmount) + BigInt(record.feeRawAmount);
    if (wrapLamports > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Native SOL funding amount is too large");
    const nativeBalance = await connection.getBalance(host, "confirmed");
    if (BigInt(nativeBalance) < wrapLamports) throw new Error("Native SOL balance no longer covers the reviewed total commitment");
    transaction.add(
      createIdempotentAtaInstruction(payer.publicKey, accounts.hostTokenAccount, host, mint),
      SystemProgram.transfer({ fromPubkey: host, toPubkey: accounts.hostTokenAccount, lamports: Number(wrapLamports) }),
      createSyncNativeInstruction(accounts.hostTokenAccount),
    );
  }
  transaction.add(
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

async function waitForSuccessfulSignature(connection: Connection, signature: string) {
  let lastStatus: Awaited<ReturnType<Connection["getSignatureStatuses"]>>["value"][number] = null;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const response = await connection.getSignatureStatuses([signature], { searchTransactionHistory: true });
    const status = response.value[0];
    if (status) {
      lastStatus = status;
      if (status.err) throw new Error("Solana rejected the Orb funding transaction");
      if (status.confirmationStatus === "confirmed" || status.confirmationStatus === "finalized" || status.confirmations === null) return status;
    }
    await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
  }
  if (lastStatus?.err) throw new Error("Solana rejected the Orb funding transaction");
  throw new Error("Funding transaction is not yet visible to the server RPC; retry confirmation in a moment");
}

async function parsedFundingTransaction(connection: Connection, signature: string, programId: PublicKey, orb: PublicKey) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const parsed = await connection.getParsedTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
    if (parsed) {
      if (parsed.meta?.err) throw new Error("Solana rejected the Orb funding transaction");
      const referencesProgram = parsed.transaction.message.instructions.some((ix) => "programId" in ix && ix.programId.equals(programId));
      const referencesOrb = parsed.transaction.message.accountKeys.some((entry) => entry.pubkey.equals(orb));
      if (!referencesProgram || !referencesOrb) throw new Error("Supplied funding signature does not reference this Orb PDA");
      return parsed;
    }
    await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
  }
  throw new Error("Funding transaction is confirmed but its transaction data is not yet visible to the server RPC; retry confirmation in a moment");
}

async function accountInfoAtOrAfterSlot(connection: Connection, address: PublicKey, minContextSlot: number) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      const response = await connection.getAccountInfoAndContext(address, { commitment: "confirmed", minContextSlot });
      if (response.value) return response.value;
    } catch (error) {
      if (attempt === 5) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
  }
  return null;
}

export async function verifyFundedOrbOnChain(record: OrbRecord, suppliedSignature = "") {
  const host = new PublicKey(record.hostWallet);
  const mint = new PublicKey(record.token.mint);
  const accounts = deriveOrbsAccounts(host, record.id, mint);
  const connection = new Connection(solanaRpcUrl(), "confirmed");

  const requested = suppliedSignature.trim() || record.fundingBroadcastSignature?.trim() || "";
  let minContextSlot = 0;
  if (requested) {
    const status = await waitForSuccessfulSignature(connection, requested);
    minContextSlot = status.slot;
    await parsedFundingTransaction(connection, requested, accounts.programId, accounts.orb);
  }

  const info = minContextSlot > 0
    ? await accountInfoAtOrAfterSlot(connection, accounts.orb, minContextSlot)
    : await connection.getAccountInfo(accounts.orb, "confirmed");
  if (!info) throw new Error("ORB_NOT_FUNDED");
  if (!info.owner.equals(accounts.programId)) throw new Error("Orb PDA is owned by an unexpected program");
  const decoded = decodeOrbAccount(Buffer.from(info.data));
  assertOrbMatchesRecord(decoded, record, host, mint);

  if (minContextSlot > 0) {
    const vaultInfo = await accountInfoAtOrAfterSlot(connection, accounts.prizeVault, minContextSlot);
    if (!vaultInfo || !vaultInfo.owner.equals(CLASSIC_SPL_TOKEN_PROGRAM_ID) || vaultInfo.data.length < 72) throw new Error("Prize vault is missing or malformed");
    const vaultAmount = Buffer.from(vaultInfo.data).readBigUInt64LE(64);
    if (vaultAmount < BigInt(record.prizeRawAmount)) throw new Error("Prize vault is underfunded");
  } else {
    const vault = await connection.getTokenAccountBalance(accounts.prizeVault, "confirmed");
    if (BigInt(vault.value.amount) < BigInt(record.prizeRawAmount)) throw new Error("Prize vault is underfunded");
  }

  if (requested) {
    return { signature: requested, orbPda: accounts.orb.toBase58(), prizeVault: accounts.prizeVault.toBase58() };
  }

  const signatures = await connection.getSignaturesForAddress(accounts.orb, { limit: 20 }, "confirmed");
  const successful = signatures.filter((entry) => !entry.err);
  if (!successful.length) throw new Error("Funded Orb has no successful creation transaction");
  let signature = "";
  for (const candidate of successful) {
    const parsed = await connection.getParsedTransaction(candidate.signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
    if (!parsed || parsed.meta?.err) continue;
    const referencesProgram = parsed.transaction.message.instructions.some((ix) => "programId" in ix && ix.programId.equals(accounts.programId));
    const referencesOrb = parsed.transaction.message.accountKeys.some((entry) => entry.pubkey.equals(accounts.orb));
    if (!referencesProgram || !referencesOrb) continue;
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


export type OnchainRefundableOrb = {
  orbPda: string;
  orbIdHex: string;
  host: string;
  mint: string;
  prizeVault: string;
  prizeRawAmount: string;
  vaultRawAmount: string;
  decimals: number;
  tokenAmount: number | null;
  startsAt: number;
  refundAfter: number;
};

function decodeClassicTokenAccount(data: Buffer, expectedMint: PublicKey, expectedOwner: PublicKey) {
  if (data.length < 165) throw new Error("Prize vault token account is malformed");
  const mint = new PublicKey(data.subarray(0, 32));
  const owner = new PublicKey(data.subarray(32, 64));
  const amount = data.readBigUInt64LE(64);
  if (!mint.equals(expectedMint) || !owner.equals(expectedOwner)) {
    throw new Error("Prize vault identities do not match the on-chain Orb");
  }
  return { amount };
}

function decodeClassicMintDecimals(data: Buffer) {
  if (data.length < 82) throw new Error("Mint account is malformed");
  return data.readUInt8(44);
}

async function getMultipleAccountInfosChunked(connection: Connection, keys: PublicKey[]) {
  const out = new Map<string, Awaited<ReturnType<Connection["getMultipleAccountsInfo"]>>[number]>();
  for (let i = 0; i < keys.length; i += 100) {
    const chunk = keys.slice(i, i + 100);
    const infos = await connection.getMultipleAccountsInfo(chunk, "confirmed");
    chunk.forEach((key, index) => out.set(key.toBase58(), infos[index] ?? null));
  }
  return out;
}

/**
 * Reads the deployed program directly. This deliberately does not consult Redis/OrbRecord,
 * so orphaned historical escrows remain recoverable even if their web record is missing.
 */
export async function scanRefundableOnchainOrbs(): Promise<OnchainRefundableOrb[]> {
  const connection = new Connection(solanaRpcUrl(), "confirmed");
  const programId = orbsProgramId();
  const now = BigInt(Math.floor(Date.now() / 1000));
  const accounts = await connection.getProgramAccounts(programId, {
    commitment: "confirmed",
    filters: [
      { dataSize: 113 },
      { memcmp: { offset: 0, bytes: bs58.encode(ORB_ACCOUNT_DISCRIMINATOR) } },
    ],
  });

  const expired = accounts.flatMap(({ pubkey, account }) => {
    try {
      const decoded = decodeOrbAccount(Buffer.from(account.data));
      if (decoded.refundAfter > now) return [];
      const [expectedOrb] = PublicKey.findProgramAddressSync(
        [ORB_SEED, decoded.host.toBuffer(), Buffer.from(decoded.orbIdHex, "hex")],
        programId,
      );
      if (!expectedOrb.equals(pubkey)) return [];
      const prizeVault = deriveClassicAta(pubkey, decoded.mint);
      return [{ pubkey, decoded, prizeVault }];
    } catch {
      return [];
    }
  });

  if (!expired.length) return [];
  const vaultKeys = expired.map((entry) => entry.prizeVault);
  const mintKeys = [...new Map(expired.map((entry) => [entry.decoded.mint.toBase58(), entry.decoded.mint])).values()];
  const [vaultInfos, mintInfos] = await Promise.all([
    getMultipleAccountInfosChunked(connection, vaultKeys),
    getMultipleAccountInfosChunked(connection, mintKeys),
  ]);

  const refundable: OnchainRefundableOrb[] = [];
  for (const entry of expired) {
    const vaultInfo = vaultInfos.get(entry.prizeVault.toBase58());
    if (!vaultInfo || !vaultInfo.owner.equals(CLASSIC_SPL_TOKEN_PROGRAM_ID)) continue;
    let vaultAmount: bigint;
    let decimals = 0;
    try {
      vaultAmount = decodeClassicTokenAccount(Buffer.from(vaultInfo.data), entry.decoded.mint, entry.pubkey).amount;
      const mintInfo = mintInfos.get(entry.decoded.mint.toBase58());
      if (!mintInfo || !mintInfo.owner.equals(CLASSIC_SPL_TOKEN_PROGRAM_ID)) continue;
      decimals = decodeClassicMintDecimals(Buffer.from(mintInfo.data));
    } catch {
      continue;
    }
    if (vaultAmount <= BigInt(0)) continue;
    const divisor = 10 ** decimals;
    const asNumber = Number(vaultAmount);
    refundable.push({
      orbPda: entry.pubkey.toBase58(),
      orbIdHex: entry.decoded.orbIdHex,
      host: entry.decoded.host.toBase58(),
      mint: entry.decoded.mint.toBase58(),
      prizeVault: entry.prizeVault.toBase58(),
      prizeRawAmount: entry.decoded.prizeAmount.toString(),
      vaultRawAmount: vaultAmount.toString(),
      decimals,
      tokenAmount: Number.isSafeInteger(asNumber) && Number.isFinite(divisor) ? asNumber / divisor : null,
      startsAt: Number(entry.decoded.startsAt) * 1000,
      refundAfter: Number(entry.decoded.refundAfter) * 1000,
    });
  }
  return refundable.sort((a, b) => a.refundAfter - b.refundAfter);
}

/**
 * Builds a permissionless refund directly from verified on-chain Orb state.
 * Anchor constrains the destination to the original host's canonical ATA, so neither
 * the admin caller nor the relayer can redirect prize funds.
 */
export async function buildOnchainRefundTransaction(orbPdaInput: string) {
  const connection = new Connection(solanaRpcUrl(), "confirmed");
  const programId = orbsProgramId();
  const orbPda = new PublicKey(orbPdaInput);
  const info = await connection.getAccountInfo(orbPda, "confirmed");
  if (!info) throw new Error("Orb escrow is already closed");
  if (!info.owner.equals(programId)) throw new Error("Account is not owned by the Orbs program");
  const decoded = decodeOrbAccount(Buffer.from(info.data));
  const [expectedOrb] = PublicKey.findProgramAddressSync(
    [ORB_SEED, decoded.host.toBuffer(), Buffer.from(decoded.orbIdHex, "hex")],
    programId,
  );
  if (!expectedOrb.equals(orbPda)) throw new Error("Orb PDA does not match its on-chain host/id seeds");
  if (BigInt(Math.floor(Date.now() / 1000)) < decoded.refundAfter) throw new Error("Orb has not reached its on-chain refund time");

  const mint = decoded.mint;
  const prizeVault = deriveClassicAta(orbPda, mint);
  const vaultInfo = await connection.getAccountInfo(prizeVault, "confirmed");
  if (!vaultInfo || !vaultInfo.owner.equals(CLASSIC_SPL_TOKEN_PROGRAM_ID)) throw new Error("Prize vault is missing or not a classic SPL token account");
  const vault = decodeClassicTokenAccount(Buffer.from(vaultInfo.data), mint, orbPda);
  if (vault.amount <= BigInt(0)) throw new Error("Prize vault is already empty");

  const payer = serverRelayerKeypair();
  const hostTokenAccount = deriveClassicAta(decoded.host, mint);
  const keys: AccountMeta[] = [
    { pubkey: payer.publicKey, isSigner: true, isWritable: true },
    { pubkey: ORBS_RENT_RECEIVER_WALLET, isSigner: false, isWritable: true },
    { pubkey: orbPda, isSigner: false, isWritable: true },
    { pubkey: mint, isSigner: false, isWritable: false },
    { pubkey: prizeVault, isSigner: false, isWritable: true },
    { pubkey: decoded.host, isSigner: false, isWritable: false },
    { pubkey: hostTokenAccount, isSigner: false, isWritable: true },
    { pubkey: CLASSIC_SPL_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];
  const latest = await connection.getLatestBlockhash("confirmed");
  const tx = new Transaction({ feePayer: payer.publicKey, recentBlockhash: latest.blockhash }).add(
    new TransactionInstruction({ programId, keys, data: REFUND_DISCRIMINATOR }),
  );
  tx.partialSign(payer);
  return { connection, tx, latest, orbPda, prizeVault, decoded, vaultAmount: vault.amount };
}

export async function verifyOnchainRefundClosed(connection: Connection, orbPda: PublicKey, prizeVault: PublicKey) {
  const [orbInfo, vaultInfo] = await Promise.all([
    connection.getAccountInfo(orbPda, "confirmed"),
    connection.getAccountInfo(prizeVault, "confirmed"),
  ]);
  if (orbInfo || vaultInfo) throw new Error("Refund transaction confirmed but escrow accounts are still open");
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


export async function buildNativeSolUnwrapTransaction(record: OrbRecord, winner: PublicKey) {
  if (record.token.isNativeSol !== true || !new PublicKey(record.token.mint).equals(WRAPPED_SOL_MINT)) {
    throw new Error("This Orb prize is not native SOL");
  }
  const payer = serverRelayerKeypair();
  const connection = new Connection(solanaRpcUrl(), "confirmed");
  const winnerAta = deriveClassicAta(winner, WRAPPED_SOL_MINT);
  const info = await connection.getAccountInfo(winnerAta, "confirmed");
  if (!info) return { alreadyUnwrapped: true as const };

  const latest = await connection.getLatestBlockhash("confirmed");
  const tx = new Transaction({ feePayer: payer.publicKey, recentBlockhash: latest.blockhash }).add(
    createCloseTokenAccountInstruction(winnerAta, winner, winner),
  );
  tx.partialSign(payer);
  return {
    alreadyUnwrapped: false as const,
    transactionBase64: tx.serialize({ requireAllSignatures: false, verifySignatures: true }).toString("base64"),
    blockhash: latest.blockhash,
    lastValidBlockHeight: latest.lastValidBlockHeight,
    winnerAta: winnerAta.toBase58(),
  };
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
