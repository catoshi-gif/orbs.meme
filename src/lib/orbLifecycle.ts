export const ORB_COMPETITION_WINDOW_MS = 6 * 60 * 60 * 1000;
// Keep a browser/server safety margin above the on-chain 30-second minimum so
// wallet approval and RPC propagation do not race the immutable start gate.
export const ORB_CREATION_MIN_LEAD_MS = 60 * 1000;
export const ORB_HISTORY_TTL_SECONDS = 90 * 24 * 60 * 60;

const TEST_ADMIN_WALLET = "EDxq8pn8assS3Zoco5UBm3suPNu6oum3fzEwCsZixWC4";

function configuredAdminWallets() {
  return [process.env.ADMIN_WALLET || "", ...(process.env.ORBS_ADMIN_WALLETS || "").split(",")]
    .map((value) => value.trim())
    .filter(Boolean);
}

export function isAdminWallet(wallet: string) {
  return wallet === TEST_ADMIN_WALLET || configuredAdminWallets().includes(wallet);
}

export function orbEndsAt(orb: { startsAt: number; endsAt?: number }) {
  return Number.isFinite(orb.endsAt) && Number(orb.endsAt) > orb.startsAt
    ? Number(orb.endsAt)
    : orb.startsAt + ORB_COMPETITION_WINDOW_MS;
}

export const activeHostedOrbKey = (wallet: string) => `orbs:v1:host-active:${wallet}`;
export const enteredOrbsKey = (wallet: string) => `orbs:v1:entered:${wallet}`;
