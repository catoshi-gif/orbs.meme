import { createHash } from "@/lib/browserHash";
import { PublicKey, SystemProgram, Transaction, type TransactionInstruction } from "@solana/web3.js";
import { ORB_COMPETITION_WINDOW_MS } from "@/lib/orbLifecycle";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  CLASSIC_SPL_TOKEN_PROGRAM_ID,
  ORBS_RENT_RECEIVER_WALLET,
  ORBS_TREASURY_WALLET,
  deriveClassicAta,
} from "@/lib/solanaAddresses";

const ORB_SEED = new TextEncoder().encode("orb");
const FUND_DISCRIMINATOR = createHash("global:fund_orb");

export type ReviewedFundingIntent = {
  host: PublicKey;
  mint: PublicKey;
  tokenDecimals: number;
  prizeRawAmount: bigint;
  feeRawAmount: bigint;
  startsAtUnixSeconds: bigint;
};

function programId() {
  const deployed = new PublicKey("464cqCX4vMoQFjeuVinz3R6ccrFz68WqEkSvFSGg7Fns");
  const configured = (process.env.NEXT_PUBLIC_ORBS_PROGRAM_ID || "").trim();
  if (configured && !new PublicKey(configured).equals(deployed)) throw new Error("Configured Orbs program id does not match production");
  return deployed;
}

function readU64(data: Uint8Array, offset: number) {
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getBigUint64(offset, true);
}
function readI64(data: Uint8Array, offset: number) {
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getBigInt64(offset, true);
}
function equalBytes(a: Uint8Array, b: Uint8Array) {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}
function assertMeta(meta: { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }, pubkey: PublicKey, signer: boolean, writable: boolean, label: string) {
  if (!meta.pubkey.equals(pubkey) || meta.isSigner !== signer || meta.isWritable !== writable) {
    throw new Error(`Funding transaction failed client security check: invalid ${label}`);
  }
}
function assertIxProgram(ix: TransactionInstruction, id: PublicKey, label: string) {
  if (!ix.programId.equals(id)) throw new Error(`Funding transaction failed client security check: unexpected ${label} program`);
}

export function assertReviewedFundingTransaction(transaction: Transaction, expected: ReviewedFundingIntent) {
  const id = programId();
  if (!transaction.feePayer?.equals(ORBS_RENT_RECEIVER_WALLET)) throw new Error("Funding transaction has an unexpected fee payer");
  if (transaction.instructions.length !== 3) throw new Error("Funding transaction must contain exactly treasury ATA creation, fee transfer, and fund_orb");
  if (!Number.isInteger(expected.tokenDecimals) || expected.tokenDecimals < 0 || expected.tokenDecimals > 255) throw new Error("Invalid reviewed token decimals");

  const orbId = transaction.instructions[2]!.data.subarray(8, 24);
  if (orbId.length !== 16 || orbId.every((byte) => byte === 0)) throw new Error("Funding transaction contains an invalid Orb id");
  const [orb] = PublicKey.findProgramAddressSync([ORB_SEED, expected.host.toBuffer(), orbId], id);
  const hostAta = deriveClassicAta(expected.host, expected.mint);
  const prizeVault = deriveClassicAta(orb, expected.mint);
  const treasuryAta = deriveClassicAta(ORBS_TREASURY_WALLET, expected.mint);

  const ataIx = transaction.instructions[0]!;
  assertIxProgram(ataIx, ASSOCIATED_TOKEN_PROGRAM_ID, "Associated Token");
  if (!equalBytes(ataIx.data, Uint8Array.from([1]))) throw new Error("Funding transaction has an unexpected treasury ATA instruction");
  if (ataIx.keys.length !== 6) throw new Error("Funding transaction treasury ATA instruction has unexpected accounts");
  assertMeta(ataIx.keys[0]!, ORBS_RENT_RECEIVER_WALLET, true, true, "treasury ATA payer");
  assertMeta(ataIx.keys[1]!, treasuryAta, false, true, "treasury ATA");
  assertMeta(ataIx.keys[2]!, ORBS_TREASURY_WALLET, false, false, "treasury ATA owner");
  assertMeta(ataIx.keys[3]!, expected.mint, false, false, "treasury ATA mint");
  assertMeta(ataIx.keys[4]!, SystemProgram.programId, false, false, "System Program");
  assertMeta(ataIx.keys[5]!, CLASSIC_SPL_TOKEN_PROGRAM_ID, false, false, "classic SPL Token Program");

  const feeIx = transaction.instructions[1]!;
  assertIxProgram(feeIx, CLASSIC_SPL_TOKEN_PROGRAM_ID, "fee transfer");
  if (feeIx.data.length !== 10 || feeIx.data[0] !== 12) throw new Error("Funding transaction has an unexpected protocol-fee instruction");
  if (readU64(feeIx.data, 1) !== expected.feeRawAmount || feeIx.data[9] !== expected.tokenDecimals) {
    throw new Error("Funding transaction fee does not match what you reviewed");
  }
  if (feeIx.keys.length !== 4) throw new Error("Funding transaction fee transfer has unexpected accounts");
  assertMeta(feeIx.keys[0]!, hostAta, false, true, "fee source");
  assertMeta(feeIx.keys[1]!, expected.mint, false, false, "fee mint");
  assertMeta(feeIx.keys[2]!, treasuryAta, false, true, "fee treasury destination");
  assertMeta(feeIx.keys[3]!, expected.host, true, true, "fee authority");

  const fundIx = transaction.instructions[2]!;
  assertIxProgram(fundIx, id, "Orbs");
  if (fundIx.data.length !== 48 || !equalBytes(fundIx.data.subarray(0, 8), FUND_DISCRIMINATOR)) {
    throw new Error("Funding transaction contains an unexpected Orbs instruction");
  }
  const prizeRaw = readU64(fundIx.data, 24);
  const startsAt = readI64(fundIx.data, 32);
  const refundAfter = readI64(fundIx.data, 40);
  if (prizeRaw !== expected.prizeRawAmount) throw new Error("Funding transaction prize does not match what you reviewed");
  if (startsAt !== expected.startsAtUnixSeconds) throw new Error("Funding transaction launch time does not match what you reviewed");
  if (refundAfter !== startsAt + BigInt(Math.floor(ORB_COMPETITION_WINDOW_MS / 1000))) throw new Error("Funding transaction has an unexpected custody/refund window");
  if (fundIx.keys.length !== 9) throw new Error("Funding transaction fund_orb has unexpected accounts");
  assertMeta(fundIx.keys[0]!, expected.host, true, true, "host");
  assertMeta(fundIx.keys[1]!, ORBS_RENT_RECEIVER_WALLET, true, true, "rent payer");
  assertMeta(fundIx.keys[2]!, orb, false, true, "Orb PDA");
  assertMeta(fundIx.keys[3]!, expected.mint, false, false, "mint");
  assertMeta(fundIx.keys[4]!, hostAta, false, true, "host token account");
  assertMeta(fundIx.keys[5]!, prizeVault, false, true, "isolated prize vault");
  assertMeta(fundIx.keys[6]!, CLASSIC_SPL_TOKEN_PROGRAM_ID, false, false, "classic SPL Token Program");
  assertMeta(fundIx.keys[7]!, ASSOCIATED_TOKEN_PROGRAM_ID, false, false, "Associated Token Program");
  assertMeta(fundIx.keys[8]!, SystemProgram.programId, false, false, "System Program");

  const requiredSigners = [expected.host, ORBS_RENT_RECEIVER_WALLET];
  if (transaction.signatures.length !== requiredSigners.length) throw new Error("Funding transaction failed client security check: unexpected signer set");
  for (const signer of requiredSigners) {
    if (!transaction.signatures.some((entry) => entry.publicKey.equals(signer))) throw new Error("Funding transaction failed client security check: missing required signer");
  }
  const hostSignature = transaction.signatures.find((entry) => entry.publicKey.equals(expected.host));
  const payerSignature = transaction.signatures.find((entry) => entry.publicKey.equals(ORBS_RENT_RECEIVER_WALLET));
  if (hostSignature?.signature) throw new Error("Funding transaction failed client security check: unexpected pre-existing host signature");
  if (!payerSignature?.signature || !transaction.verifySignatures(false)) throw new Error("Funding transaction failed client security check: invalid relayer signature");

  return { programId: id, orb, prizeVault, treasuryAta };
}
