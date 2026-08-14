import "server-only";

import type { OrbRecord } from "@/lib/orbStore";
import { orbEndsAt } from "@/lib/orbLifecycle";
import { redisCommand } from "@/lib/upstash";
import { getWinners, type WinnerRecord } from "@/lib/upstashWinner";

export type AdminGameRow = {
  slug: string;
  id: string;
  createdAt: number;
  startsAt: number;
  endsAt: number;
  phase: "funding-pending" | "upcoming" | "live" | "won" | "expired";
  hostWallet: string;
  hostXUsername: string;
  participants: number;
  verifiedEntryPosts: number;
  prizeUsd: number;
  prizeTokenAmount: number;
  tokenSymbol: string;
  feeUsd: number;
  winnerXUsername: string | null;
  winnerWallet: string | null;
  verifiedElapsedMs: number | null;
  claimed: boolean;
  fundingTxSignature: string | null;
  claimTxSignature: string | null;
};

async function allOrbRecords(limit = 500) {
  let cursor = "0";
  let passes = 0;
  const records: OrbRecord[] = [];
  do {
    const scan = await redisCommand<[string, string[]]>(["SCAN", cursor, "MATCH", "orbs:v1:orb:*", "COUNT", "200"]);
    if (!scan) break;
    cursor = String(scan[0] || "0");
    const keys = scan[1] || [];
    if (keys.length) {
      const raw = await redisCommand<Array<string | null>>(["MGET", ...keys]);
      for (const value of raw || []) {
        if (!value) continue;
        try {
          const record = JSON.parse(value) as OrbRecord;
          if (record?.id && record?.slug) records.push(record);
        } catch {}
      }
    }
    passes += 1;
  } while (cursor !== "0" && passes < 50 && records.length < limit);
  return records.sort((a,b) => b.createdAt - a.createdAt).slice(0, limit);
}

function phaseFor(record: OrbRecord, winner: WinnerRecord | undefined, now: number): AdminGameRow["phase"] {
  if (record.status === "funding-pending") return "funding-pending";
  if (winner) return "won";
  if (now < record.startsAt) return "upcoming";
  if (now < orbEndsAt(record)) return "live";
  return "expired";
}

export async function getAdminMetrics() {
  const records = await allOrbRecords();
  const winners = await getWinners(records.map((r) => r.id));
  const entrantMembers = await Promise.all(records.map(async (record) => {
    const members = await redisCommand<string[]>(["SMEMBERS", `orbs:v1:entrants:${record.slug}`]);
    return members || [];
  }));
  const now = Date.now();
  const funded = records.filter((r) => r.status !== "funding-pending");
  const rows: AdminGameRow[] = records.map((record, index) => {
    const winner = winners.get(record.id);
    const participants = entrantMembers[index]?.length || 0;
    return {
      slug: record.slug,
      id: record.id,
      createdAt: record.createdAt,
      startsAt: record.startsAt,
      endsAt: orbEndsAt(record),
      phase: phaseFor(record, winner, now),
      hostWallet: record.hostWallet,
      hostXUsername: record.hostX?.username || "unknown",
      participants,
      verifiedEntryPosts: participants,
      prizeUsd: Number(record.prizeUsd || 0),
      prizeTokenAmount: Number(record.prizeTokenAmount || 0),
      tokenSymbol: record.token?.symbol || "SPL",
      feeUsd: Number(record.feeUsd || 0),
      winnerXUsername: winner?.xUsername || null,
      winnerWallet: winner?.wallet || null,
      verifiedElapsedMs: winner?.verifiedElapsedMs || null,
      claimed: Boolean(winner?.claimTxSignature),
      fundingTxSignature: record.fundingTxSignature || null,
      claimTxSignature: winner?.claimTxSignature || null,
    };
  });

  const uniqueHosts = new Set(funded.map((r) => r.hostWallet));
  const uniqueHostX = new Set(funded.map((r) => r.hostX?.id).filter(Boolean));
  const uniqueEntrants = new Set(entrantMembers.flat());
  const winnerRows = rows.filter((r) => r.phase === "won");
  const claimed = winnerRows.filter((r) => r.claimed);
  const finishTimes = winnerRows.map((r) => r.verifiedElapsedMs).filter((v): v is number => Number.isFinite(v));
  const totalParticipants = rows.reduce((sum, row) => sum + row.participants, 0);

  return {
    generatedAt: new Date().toISOString(),
    totals: {
      orbRecords: records.length,
      fundedOrbs: funded.length,
      upcoming: rows.filter((r) => r.phase === "upcoming").length,
      live: rows.filter((r) => r.phase === "live").length,
      completedWithWinner: winnerRows.length,
      expiredWithoutWinner: rows.filter((r) => r.phase === "expired").length,
      fundingPending: rows.filter((r) => r.phase === "funding-pending").length,
      uniqueHostWallets: uniqueHosts.size,
      uniqueHostXAccounts: uniqueHostX.size,
      totalQualifiedEntries: totalParticipants,
      uniqueEntrantBindings: uniqueEntrants.size,
      verifiedEntryPosts: totalParticipants,
      claimedPrizes: claimed.length,
      totalWinnerPrizeUsdAtFunding: funded.reduce((sum, r) => sum + Number(r.prizeUsd || 0), 0),
      totalProtocolFeesUsdAtFunding: funded.reduce((sum, r) => sum + Number(r.feeUsd || 0), 0),
      averageEntriesPerFundedOrb: funded.length ? totalParticipants / funded.length : 0,
      averageVerifiedWinMs: finishTimes.length ? finishTimes.reduce((a,b) => a+b, 0) / finishTimes.length : null,
      fastestVerifiedWinMs: finishTimes.length ? Math.min(...finishTimes) : null,
    },
    xMetrics: {
      impressionsCollected: false,
      reason: "Automatic X impression polling is intentionally disabled to avoid API spend and because creator share-post IDs are not currently stored as canonical game data.",
    },
    games: rows,
  };
}
