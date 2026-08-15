import "server-only";

import type { OrbRecord } from "@/lib/orbStore";
import { orbEndsAt } from "@/lib/orbLifecycle";
import { redisCommand } from "@/lib/upstash";
import { getWinners, type WinnerRecord } from "@/lib/upstashWinner";
import {
  ensureAnalyticsCounterAtLeast,
  getDurableAnalyticsTotals,
  getDurableOrbAnalytics,
  recordClaimAnalytics,
  recordFundedOrbAnalytics,
  recordHostSharePostAnalytics,
  recordWinnerAnalytics,
  type DurableOrbAnalytics,
} from "@/lib/durableAnalytics";

export type AdminGameRow = {
  slug: string;
  id: string;
  createdAt: number;
  startsAt: number;
  endsAt: number;
  phase: "funding-pending" | "upcoming" | "live" | "won" | "expired";
  hostWallet: string | null;
  hostXUsername: string;
  hostSharePostId: string | null;
  xImpressions: number | null;
  xLikes: number | null;
  xReposts: number | null;
  xReplies: number | null;
  xQuotes: number | null;
  xMetricsRefreshedAt: number | null;
  waitingRoomVisitors: number;
  participants: number;
  verifiedEntryPosts: number;
  liveRacers: number;
  registrationRate: number | null;
  showRate: number | null;
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

export async function allOrbRecords(limit = 500) {
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

type CachedXMetrics = {
  postId: string;
  impressions: number;
  likes: number;
  reposts: number;
  replies: number;
  quotes: number;
  refreshedAt: number;
};
const xMetricKey = (postId: string) => `orbs:v1:admin:xmetrics:${postId}`;

function phaseForDurable(row: DurableOrbAnalytics, now: number): AdminGameRow["phase"] {
  if (row.winnerXUsername) return "won";
  if (now < row.startsAt) return "upcoming";
  if (now < row.endsAt) return "live";
  return "expired";
}

async function backfillCurrentHistory(records: OrbRecord[], winners: Map<string, WinnerRecord>, entrantCounts: Map<string, number>) {
  for (const record of records) {
    if (record.status === "funding-pending" || !record.fundingTxSignature) continue;
    await recordFundedOrbAnalytics({
      slug: record.slug,
      orbId: record.id,
      createdAt: record.createdAt,
      // Old operational records did not retain a distinct funding timestamp.
      // createdAt is the safest deterministic approximation for the one-time backfill.
      fundedAt: record.createdAt,
      startsAt: record.startsAt,
      endsAt: orbEndsAt(record),
      hostXUsername: record.hostX?.username || "unknown",
      tokenSymbol: record.token?.symbol || "SPL",
      prizeUsd: Number(record.prizeUsd || 0),
      prizeTokenAmount: Number(record.prizeTokenAmount || 0),
      feeUsd: Number(record.feeUsd || 0),
      fundingTxSignature: record.fundingTxSignature,
    });
    await ensureAnalyticsCounterAtLeast(record.slug, "qualifiedEntries", entrantCounts.get(record.slug) || 0);
    if (record.hostSharePostId) await recordHostSharePostAnalytics(record.slug, record.hostSharePostId);
    const winner = winners.get(record.id);
    if (winner) {
      await recordWinnerAnalytics({
        slug: record.slug,
        orbId: record.id,
        xUsername: winner.xUsername,
        verifiedElapsedMs: winner.verifiedElapsedMs,
        verifiedAt: winner.verifiedAt,
      });
      if (winner.claimTxSignature && winner.claimedAt) {
        await recordClaimAnalytics({ slug: record.slug, orbId: record.id, claimTxSignature: winner.claimTxSignature, claimedAt: winner.claimedAt });
      }
    }
  }
}

export async function getAdminMetrics() {
  // Operational records expire after the normal product-retention window. We use
  // them only to backfill whatever history is still available and to enrich recent
  // rows. Durable analytics below is the lifetime source of truth.
  const records = await allOrbRecords(1000);
  const fundedRecords = records.filter((r) => r.status !== "funding-pending" && Boolean(r.fundingTxSignature));
  const winners = await getWinners(fundedRecords.map((r) => r.id));
  const entrantCounts = new Map<string, number>();
  await Promise.all(fundedRecords.map(async (record) => {
    entrantCounts.set(record.slug, Number(await redisCommand<number>(["SCARD", `orbs:v1:entrants:${record.slug}`]) || 0));
  }));
  await backfillCurrentHistory(fundedRecords, winners, entrantCounts);

  const [durable, lifetime] = await Promise.all([getDurableOrbAnalytics(1000), getDurableAnalyticsTotals()]);
  const currentBySlug = new Map(records.map((record) => [record.slug, record]));
  const currentWinnerBySlug = new Map<string, WinnerRecord>();
  for (const record of fundedRecords) {
    const winner = winners.get(record.id);
    if (winner) currentWinnerBySlug.set(record.slug, winner);
  }

  const postIds = durable.map((r) => r.hostSharePostId).filter((id): id is string => Boolean(id));
  const cachedX = new Map<string, CachedXMetrics>();
  if (postIds.length) {
    const raw = await redisCommand<Array<string | null>>(["MGET", ...postIds.map(xMetricKey)]);
    postIds.forEach((id, index) => {
      const value = raw?.[index];
      if (!value) return;
      try { cachedX.set(id, JSON.parse(value) as CachedXMetrics); } catch {}
    });
  }

  const now = Date.now();
  const rows: AdminGameRow[] = durable.map((row) => {
    const current = currentBySlug.get(row.slug);
    const currentWinner = currentWinnerBySlug.get(row.slug);
    const x = row.hostSharePostId ? cachedX.get(row.hostSharePostId) : undefined;
    return {
      slug: row.slug,
      id: row.orbId,
      createdAt: row.createdAt,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      phase: phaseForDurable(row, now),
      hostWallet: current?.hostWallet || null,
      hostXUsername: row.hostXUsername,
      hostSharePostId: row.hostSharePostId,
      xImpressions: x?.impressions ?? null,
      xLikes: x?.likes ?? null,
      xReposts: x?.reposts ?? null,
      xReplies: x?.replies ?? null,
      xQuotes: x?.quotes ?? null,
      xMetricsRefreshedAt: x?.refreshedAt ?? null,
      waitingRoomVisitors: row.waitingRoomVisitors,
      participants: row.qualifiedEntries,
      verifiedEntryPosts: row.qualifiedEntries,
      liveRacers: row.liveRacers,
      registrationRate: row.waitingRoomVisitors ? row.qualifiedEntries / row.waitingRoomVisitors : null,
      showRate: row.qualifiedEntries ? row.liveRacers / row.qualifiedEntries : null,
      prizeUsd: row.prizeUsd,
      prizeTokenAmount: row.prizeTokenAmount,
      tokenSymbol: row.tokenSymbol,
      feeUsd: row.feeUsd,
      winnerXUsername: row.winnerXUsername,
      winnerWallet: currentWinner?.wallet || null,
      verifiedElapsedMs: row.winnerVerifiedElapsedMs,
      claimed: Boolean(row.claimTxSignature),
      fundingTxSignature: row.fundingTxSignature || null,
      claimTxSignature: row.claimTxSignature,
    };
  });

  // Pending records are useful operationally but intentionally never enter the
  // permanent funded-Orb ledger.
  const pending = records.filter((record) => record.status === "funding-pending");
  const finishTimes = durable.map((r) => r.winnerVerifiedElapsedMs).filter((v): v is number => Number.isFinite(v));
  const uniqueHostX = new Set(durable.map((r) => r.hostXUsername).filter((value) => value && value !== "unknown"));
  const average = (numerator: number, denominator: number) => denominator ? numerator / denominator : 0;

  return {
    generatedAt: new Date().toISOString(),
    durableAnalyticsSince: "v1",
    totals: {
      orbRecords: durable.length + pending.length,
      fundedOrbs: lifetime.fundedOrbs,
      upcoming: rows.filter((r) => r.phase === "upcoming").length,
      live: rows.filter((r) => r.phase === "live").length,
      completedWithWinner: lifetime.winners,
      expiredWithoutWinner: rows.filter((r) => r.phase === "expired").length,
      fundingPending: pending.length,
      uniqueHostWallets: null,
      uniqueHostXAccounts: uniqueHostX.size,
      waitingRoomVisitors: lifetime.waitingRoomVisitors,
      totalQualifiedEntries: lifetime.qualifiedEntries,
      uniqueEntrantBindings: null,
      verifiedEntryPosts: lifetime.qualifiedEntries,
      totalLiveRacers: lifetime.liveRacers,
      claimedPrizes: lifetime.claimedPrizes,
      totalWinnerPrizeUsdAtFunding: lifetime.totalWinnerPrizeUsdAtFunding,
      totalProtocolFeesUsdAtFunding: lifetime.totalProtocolFeesUsdAtFunding,
      averageWaitingVisitorsPerFundedOrb: average(lifetime.waitingRoomVisitors, lifetime.fundedOrbs),
      averageEntriesPerFundedOrb: average(lifetime.qualifiedEntries, lifetime.fundedOrbs),
      averageRacersPerFundedOrb: average(lifetime.liveRacers, lifetime.fundedOrbs),
      waitingToRegistrationRate: lifetime.waitingRoomVisitors ? lifetime.qualifiedEntries / lifetime.waitingRoomVisitors : null,
      registrationToRaceRate: lifetime.qualifiedEntries ? lifetime.liveRacers / lifetime.qualifiedEntries : null,
      averageVerifiedWinMs: finishTimes.length ? finishTimes.reduce((a,b) => a+b, 0) / finishTimes.length : null,
      fastestVerifiedWinMs: finishTimes.length ? Math.min(...finishTimes) : null,
    },
    xMetrics: {
      enabled: Boolean((process.env.X_BEARER_TOKEN || "").trim()),
      trackedPosts: postIds.length,
      estimatedRefreshUsd: postIds.length * 0.005,
      totalImpressions: rows.reduce((sum, row) => sum + Number(row.xImpressions || 0), 0),
      reason: postIds.length
        ? "X reach is refreshed only when an authenticated admin explicitly requests it. No background polling."
        : "No creator X posts have been linked yet. Future creator posts can be verified after sharing; older games can be attached manually from this dashboard.",
    },
    games: rows,
  };
}
