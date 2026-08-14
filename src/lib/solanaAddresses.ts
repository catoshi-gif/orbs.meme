import { PublicKey } from "@solana/web3.js";

export const CLASSIC_SPL_TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
export const WRAPPED_SOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");
export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
export const ORBS_TREASURY_WALLET = new PublicKey("5mEqxr6McBRL5DGE9dJ2Td3viwhAmRpe4V7pqGTPMtvr");
export const ORBS_RENT_RECEIVER_WALLET = new PublicKey("GMpmAw9JDKhJHo6umea4BsfLHVSqBYXPvv8hTU4t84vN");
export const ORBS_TURNKEY_CLAIM_AUTHORITY_WALLET = new PublicKey("8aFRPMXaRwpMXErsRALq9eaa71ZvvB3fsuYpC8o5zFuk");
export const ORBS_ADMIN_CREATOR_WALLET = new PublicKey("EDxq8pn8assS3Zoco5UBm3suPNu6oum3fzEwCsZixWC4");

export function deriveClassicAta(owner: PublicKey, mint: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), CLASSIC_SPL_TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  )[0];
}
