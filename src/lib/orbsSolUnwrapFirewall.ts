import { PublicKey, Transaction } from "@solana/web3.js";
import { CLASSIC_SPL_TOKEN_PROGRAM_ID, ORBS_RENT_RECEIVER_WALLET, WRAPPED_SOL_MINT, deriveClassicAta } from "@/lib/solanaAddresses";

export function assertReviewedSolUnwrapTransaction(transaction: Transaction, winner: PublicKey) {
  if (!transaction.feePayer?.equals(ORBS_RENT_RECEIVER_WALLET)) throw new Error("SOL unwrap has an unexpected fee payer");
  if (transaction.instructions.length !== 1) throw new Error("SOL unwrap transaction must contain exactly one close-account instruction");
  const winnerAta = deriveClassicAta(winner, WRAPPED_SOL_MINT);
  const ix = transaction.instructions[0]!;
  if (!ix.programId.equals(CLASSIC_SPL_TOKEN_PROGRAM_ID) || ix.data.length !== 1 || ix.data[0] !== 9) throw new Error("SOL unwrap contains an unexpected instruction");
  if (ix.keys.length !== 3) throw new Error("SOL unwrap contains an unexpected account set");
  const expected = [
    { key: winnerAta, signer: false, writable: true },
    { key: winner, signer: false, writable: true },
    { key: winner, signer: true, writable: false },
  ];
  for (let i = 0; i < expected.length; i += 1) {
    const meta = ix.keys[i]!;
    const item = expected[i]!;
    // A compiled/deserialized Solana transaction exposes transaction-wide promoted
    // privileges. Require the privileges needed by this account position, but allow
    // promotion; the exact signer set is checked immediately below.
    if (
      !meta.pubkey.equals(item.key) ||
      (item.signer && !meta.isSigner) ||
      (item.writable && !meta.isWritable)
    ) {
      throw new Error("SOL unwrap failed client security review");
    }
  }
  const requiredSigners = [ORBS_RENT_RECEIVER_WALLET, winner];
  if (transaction.signatures.length !== requiredSigners.length) throw new Error("SOL unwrap has an unexpected signer set");
  const relayer = transaction.signatures.find((entry) => entry.publicKey.equals(ORBS_RENT_RECEIVER_WALLET));
  const winnerSig = transaction.signatures.find((entry) => entry.publicKey.equals(winner));
  if (!relayer?.signature || winnerSig?.signature || !transaction.verifySignatures(false)) throw new Error("SOL unwrap has invalid protected signatures");
  return { winnerAta };
}
