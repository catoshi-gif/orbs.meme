import { listEnteredOrbs, listHostedOrbs, type PublicOrbRecord } from "@/lib/orbStore";
import { orbEndsAt } from "@/lib/orbLifecycle";
import { getWinners, type WinnerRecord } from "@/lib/upstashWinner";

export type WalletOrbActivity = {
  orb: PublicOrbRecord;
  hosted: boolean;
  entered: boolean;
  phase: "upcoming" | "live" | "completed" | "expired";
  outcome: "entered" | "racing" | "won" | "dnf" | null;
  verifiedElapsedMs: number | null;
  winner: Omit<WinnerRecord, "xUserId"> | null;
  canRetrieve: boolean;
};

function publicWinner(winner: WinnerRecord | undefined) {
  if (!winner) return null;
  const { xUserId: _privateXId, ...safe } = winner;
  return safe;
}

export async function listWalletOrbActivity(wallet: string, limit = 50): Promise<WalletOrbActivity[]> {
  const [hostedOrbs, enteredOrbs] = await Promise.all([
    listHostedOrbs(wallet, limit),
    listEnteredOrbs(wallet, limit),
  ]);
  const hostedIds = new Set(hostedOrbs.map((orb) => orb.id));
  const enteredIds = new Set(enteredOrbs.map((orb) => orb.id));
  const byId = new Map<string, PublicOrbRecord>();
  [...hostedOrbs, ...enteredOrbs].forEach((orb) => byId.set(orb.id, orb));
  const orbs = [...byId.values()].sort((a, b) => b.createdAt - a.createdAt).slice(0, Math.max(1, Math.min(100, limit)));
  const winners = await getWinners(orbs.map((orb) => orb.id));
  const now = Date.now();

  return orbs.map((orb) => {
    const winner = winners.get(orb.id);
    const hosted = hostedIds.has(orb.id);
    const entered = enteredIds.has(orb.id);
    const phase = winner
      ? "completed" as const
      : now < orb.startsAt
        ? "upcoming" as const
        : now < orbEndsAt(orb)
          ? "live" as const
          : "expired" as const;
    const outcome = !entered
      ? null
      : winner?.wallet === wallet
        ? "won" as const
        : phase === "completed" || phase === "expired"
          ? "dnf" as const
          : phase === "live"
            ? "racing" as const
            : "entered" as const;
    return {
      orb,
      hosted,
      entered,
      phase,
      outcome,
      verifiedElapsedMs: outcome === "won" ? winner?.verifiedElapsedMs || null : null,
      winner: publicWinner(winner),
      canRetrieve: hosted && phase === "expired" && !winner && !orb.refundTxSignature,
    };
  });
}
