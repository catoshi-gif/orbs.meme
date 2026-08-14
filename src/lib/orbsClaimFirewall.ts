import { PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { createHash, utf8 } from "@/lib/browserHash";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  CLASSIC_SPL_TOKEN_PROGRAM_ID,
  ORBS_RENT_RECEIVER_WALLET,
  ORBS_TREASURY_WALLET,
  ORBS_TURNKEY_CLAIM_AUTHORITY_WALLET,
  deriveClassicAta,
} from "@/lib/solanaAddresses";

const CLAIM_DISCRIMINATOR = createHash("global:claim_prize");

function programId() {
  const deployed = new PublicKey("464cqCX4vMoQFjeuVinz3R6ccrFz68WqEkSvFSGg7Fns");
  const configured = (process.env.NEXT_PUBLIC_ORBS_PROGRAM_ID || "").trim();
  if (configured && !new PublicKey(configured).equals(deployed)) throw new Error("Configured Orbs program id does not match production");
  return deployed;
}
function equalBytes(a: Uint8Array, b: Uint8Array) { return a.length === b.length && a.every((v, i) => v === b[i]); }
function assertMeta(meta: { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }, pubkey: PublicKey, signer: boolean, writable: boolean, label: string) {
  // Solana promotes signer/writable privileges transaction-wide when a compiled
  // transaction is deserialized. Require privileges that must exist, while allowing
  // harmless promotion caused by the same account's use elsewhere in the transaction.
  if (
    !meta.pubkey.equals(pubkey) ||
    (signer && !meta.isSigner) ||
    (writable && !meta.isWritable)
  ) {
    throw new Error(`Claim transaction failed client security check: invalid ${label}`);
  }
}

export type ReviewedClaimIntent = { host: PublicKey; winner: PublicKey; mint: PublicKey; orbIdHex: string; claimAuthority: PublicKey };

export function assertReviewedClaimTransaction(transaction: Transaction, expected: ReviewedClaimIntent) {
  const id = programId();
  if (!transaction.feePayer?.equals(ORBS_RENT_RECEIVER_WALLET)) throw new Error("Claim transaction has an unexpected fee payer");
  if (transaction.instructions.length !== 1) throw new Error("Claim transaction must contain exactly one claim_prize instruction");
  if (!/^[0-9a-fA-F]{32}$/.test(expected.orbIdHex)) throw new Error("Invalid Orb id");
  const orbId = Uint8Array.from(expected.orbIdHex.match(/../g)!.map((byte) => Number.parseInt(byte, 16)));
  const [config] = PublicKey.findProgramAddressSync([utf8("config")], id);
  const [orb] = PublicKey.findProgramAddressSync([utf8("orb"), expected.host.toBuffer(), orbId], id);
  const prizeVault = deriveClassicAta(orb, expected.mint);
  const winnerAta = deriveClassicAta(expected.winner, expected.mint);

  const ix = transaction.instructions[0]!;
  if (!ix.programId.equals(id) || !equalBytes(ix.data, CLAIM_DISCRIMINATOR)) throw new Error("Claim transaction contains an unexpected instruction");
  if (ix.keys.length !== 12) throw new Error("Claim transaction has an unexpected account set");
  assertMeta(ix.keys[0]!, ORBS_RENT_RECEIVER_WALLET, true, true, "payer");
  assertMeta(ix.keys[1]!, ORBS_RENT_RECEIVER_WALLET, true, true, "rent receiver");
  assertMeta(ix.keys[2]!, config, false, false, "config PDA");
  assertMeta(ix.keys[3]!, expected.claimAuthority, true, false, "Turnkey claim authority");
  assertMeta(ix.keys[4]!, orb, false, true, "Orb PDA");
  assertMeta(ix.keys[5]!, expected.mint, false, false, "mint");
  assertMeta(ix.keys[6]!, prizeVault, false, true, "prize vault");
  assertMeta(ix.keys[7]!, expected.winner, true, false, "winner");
  assertMeta(ix.keys[8]!, winnerAta, false, true, "winner token account");
  assertMeta(ix.keys[9]!, CLASSIC_SPL_TOKEN_PROGRAM_ID, false, false, "classic SPL Token Program");
  assertMeta(ix.keys[10]!, ASSOCIATED_TOKEN_PROGRAM_ID, false, false, "Associated Token Program");
  assertMeta(ix.keys[11]!, SystemProgram.programId, false, false, "System Program");

  if (!expected.claimAuthority.equals(ORBS_TURNKEY_CLAIM_AUTHORITY_WALLET)) throw new Error("Claim transaction uses an unexpected Turnkey authority");
  if (expected.winner.equals(expected.host) || expected.winner.equals(expected.claimAuthority) || expected.winner.equals(ORBS_RENT_RECEIVER_WALLET) || expected.winner.equals(ORBS_TREASURY_WALLET)) {
    throw new Error("Claim transaction contains an invalid winner identity");
  }
  const expectedSigners = [ORBS_RENT_RECEIVER_WALLET, expected.claimAuthority, expected.winner];
  if (transaction.signatures.length !== expectedSigners.length) throw new Error("Claim transaction failed client security check: unexpected signer set");
  for (const signer of expectedSigners) if (!transaction.signatures.some((entry) => entry.publicKey.equals(signer))) throw new Error("Claim transaction failed client security check: missing required signer");
  const payerSig = transaction.signatures.find((entry) => entry.publicKey.equals(ORBS_RENT_RECEIVER_WALLET));
  const turnkeySig = transaction.signatures.find((entry) => entry.publicKey.equals(expected.claimAuthority));
  const winnerSig = transaction.signatures.find((entry) => entry.publicKey.equals(expected.winner));
  if (!payerSig?.signature || !turnkeySig?.signature) throw new Error("Claim transaction is missing required protected signatures");
  if (winnerSig?.signature) throw new Error("Claim transaction unexpectedly contains a pre-existing winner signature");
  if (!transaction.verifySignatures(false)) throw new Error("Claim transaction contains an invalid protected signature");
  return { orb, prizeVault, winnerAta };
}
