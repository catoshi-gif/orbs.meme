import { PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { ORB_COMPETITION_WINDOW_MS } from "@/lib/orbLifecycle";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  CLASSIC_SPL_TOKEN_PROGRAM_ID,
  ORBS_RENT_RECEIVER_WALLET,
  ORBS_TREASURY_WALLET,
  deriveClassicAta,
} from "@/lib/solanaAddresses";

const encoder = new TextEncoder();
const CONFIG_SEED = encoder.encode("config");
const ORB_SEED = encoder.encode("orb");
const HOST_POLICY_SEED = encoder.encode("host-policy");
const CREATE_DISCRIMINATOR = Uint8Array.from([0xa6, 0x72, 0x4f, 0xac, 0x90, 0x49, 0xcf, 0x05]);
const MAX_QUOTE_TTL_SECONDS = 10 * 60;

export type ReviewedFundingIntent = {
  host: PublicKey;
  mint: PublicKey;
  prizeRawAmount: bigint;
  feeRawAmount: bigint;
  startsAtUnixSeconds: bigint;
};

function clientProgramId() {
  const raw = (process.env.NEXT_PUBLIC_ORBS_PROGRAM_ID || "").trim();
  if (!raw) throw new Error("NEXT_PUBLIC_ORBS_PROGRAM_ID is not configured");
  return new PublicKey(raw);
}

function assertMeta(
  actual: { pubkey: PublicKey; isSigner: boolean; isWritable: boolean },
  expected: PublicKey,
  signer: boolean,
  writable: boolean,
  label: string,
) {
  if (!actual.pubkey.equals(expected) || actual.isSigner !== signer || actual.isWritable !== writable) {
    throw new Error(`Funding transaction failed client security check: invalid ${label}`);
  }
}

function view(data: Uint8Array) {
  return new DataView(data.buffer, data.byteOffset, data.byteLength);
}

function readU64(data: Uint8Array, offset: number) {
  return view(data).getBigUint64(offset, true);
}

function readI64(data: Uint8Array, offset: number) {
  return view(data).getBigInt64(offset, true);
}

function sameBytes(a: Uint8Array, b: Uint8Array) {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/**
 * Final browser-side firewall before the host wallet is allowed to sign.
 *
 * The server and its low-custody fee quote key are not trusted to preserve the
 * host's reviewed intent. This independently decodes the exact Anchor
 * instruction and verifies every money-routing account and economic field that
 * the host reviewed. A compromised backend can therefore make funding fail, but
 * cannot silently turn the host's signature into a different Orbs debit.
 */
export function assertReviewedFundingTransaction(transaction: Transaction, expected: ReviewedFundingIntent) {
  const programId = clientProgramId();
  if (!transaction.feePayer?.equals(ORBS_RENT_RECEIVER_WALLET)) {
    throw new Error("Funding transaction failed client security check: relayer is not the fee payer");
  }
  if (transaction.instructions.length !== 1) {
    throw new Error("Funding transaction failed client security check: unexpected extra instructions");
  }

  const ix = transaction.instructions[0]!;
  if (!ix.programId.equals(programId)) {
    throw new Error("Funding transaction failed client security check: wrong Orbs program id");
  }
  if (ix.keys.length !== 14) {
    throw new Error("Funding transaction failed client security check: unexpected account layout");
  }

  const data = new Uint8Array(ix.data);
  if (data.length !== 104 || !sameBytes(data.subarray(0, 8), CREATE_DISCRIMINATOR)) {
    throw new Error("Funding transaction failed client security check: wrong Anchor instruction");
  }

  const orbId = data.subarray(8, 24);
  if (orbId.every((byte) => byte === 0)) throw new Error("Funding transaction failed client security check: invalid Orb id");
  const prizeRaw = readU64(data, 24);
  const feeRaw = readU64(data, 40);
  const startsAt = readI64(data, 48);
  const refundAfter = readI64(data, 56);
  const quoteExpiresAt = readI64(data, 64);
  const gameCommitment = data.subarray(72, 104);

  if (prizeRaw !== expected.prizeRawAmount) throw new Error("Funding transaction prize does not match what you reviewed");
  if (feeRaw !== expected.feeRawAmount) throw new Error("Funding transaction fee does not match what you reviewed");
  if (startsAt !== expected.startsAtUnixSeconds) throw new Error("Funding transaction launch time does not match what you reviewed");
  if (refundAfter !== startsAt + BigInt(Math.floor(ORB_COMPETITION_WINDOW_MS / 1000))) {
    throw new Error("Funding transaction has an unexpected custody/refund window");
  }
  const now = BigInt(Math.floor(Date.now() / 1000));
  if (quoteExpiresAt < now || quoteExpiresAt - now > BigInt(MAX_QUOTE_TTL_SECONDS)) {
    throw new Error("Funding transaction contains an invalid or expired quote lifetime");
  }
  if (gameCommitment.every((byte) => byte === 0)) {
    throw new Error("Funding transaction contains an invalid game commitment");
  }

  const [config] = PublicKey.findProgramAddressSync([CONFIG_SEED], programId);
  const [orb] = PublicKey.findProgramAddressSync([ORB_SEED, expected.host.toBuffer(), orbId], programId);
  const [hostPolicy] = PublicKey.findProgramAddressSync([HOST_POLICY_SEED, expected.host.toBuffer()], programId);
  const hostAta = deriveClassicAta(expected.host, expected.mint);
  const prizeVault = deriveClassicAta(orb, expected.mint);
  const treasuryAta = deriveClassicAta(ORBS_TREASURY_WALLET, expected.mint);

  assertMeta(ix.keys[0]!, expected.host, true, true, "host");
  assertMeta(ix.keys[1]!, ORBS_RENT_RECEIVER_WALLET, true, true, "rent payer");
  assertMeta(ix.keys[2]!, config, false, false, "protocol config");
  if (!ix.keys[3]!.isSigner || ix.keys[3]!.isWritable) throw new Error("Funding transaction failed client security check: invalid quote signer");
  assertMeta(ix.keys[4]!, orb, false, true, "Orb PDA");
  assertMeta(ix.keys[5]!, hostPolicy, false, true, "host policy PDA");
  assertMeta(ix.keys[6]!, expected.mint, false, false, "mint");
  assertMeta(ix.keys[7]!, hostAta, false, true, "host token account");
  assertMeta(ix.keys[8]!, prizeVault, false, true, "isolated prize vault");
  assertMeta(ix.keys[9]!, ORBS_TREASURY_WALLET, false, false, "treasury");
  assertMeta(ix.keys[10]!, treasuryAta, false, true, "treasury token account");
  assertMeta(ix.keys[11]!, CLASSIC_SPL_TOKEN_PROGRAM_ID, false, false, "classic SPL Token Program");
  assertMeta(ix.keys[12]!, ASSOCIATED_TOKEN_PROGRAM_ID, false, false, "Associated Token Program");
  assertMeta(ix.keys[13]!, SystemProgram.programId, false, false, "System Program");

  const expectedSigners = [expected.host, ORBS_RENT_RECEIVER_WALLET, ix.keys[3]!.pubkey];
  if (transaction.signatures.length !== expectedSigners.length) {
    throw new Error("Funding transaction failed client security check: unexpected signer set");
  }
  for (const signer of expectedSigners) {
    if (!transaction.signatures.some((entry) => entry.publicKey.equals(signer))) {
      throw new Error("Funding transaction failed client security check: missing required signer");
    }
  }
  const hostSignature = transaction.signatures.find((entry) => entry.publicKey.equals(expected.host));
  const payerSignature = transaction.signatures.find((entry) => entry.publicKey.equals(ORBS_RENT_RECEIVER_WALLET));
  const quoteSignature = transaction.signatures.find((entry) => entry.publicKey.equals(ix.keys[3]!.pubkey));
  if (hostSignature?.signature) throw new Error("Funding transaction failed client security check: unexpected pre-existing host signature");
  if (!payerSignature?.signature || !quoteSignature?.signature || !transaction.verifySignatures(false)) {
    throw new Error("Funding transaction failed client security check: invalid server-side signatures");
  }

  return { programId, orb, prizeVault };
}
