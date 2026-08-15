import { getAdminSession } from "@/lib/adminAuth";
import { getAllDurableOrbAnalytics } from "@/lib/durableAnalytics";
import { getAdminMetrics } from "@/lib/adminMetrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

function csvCell(value: unknown) {
  const text = value == null ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

export async function GET() {
  if (!await getAdminSession()) return new Response("Admin wallet authentication required", { status: 401 });
  // Force the idempotent current-history backfill before generating the lifetime report.
  await getAdminMetrics();
  const rows = await getAllDurableOrbAnalytics();
  const header = [
    "slug", "orb_id", "funded_at_utc", "launch_at_utc", "ended_at_utc", "host_x_username",
    "token_symbol", "prize_usd_at_funding", "prize_token_amount", "protocol_fee_usd_at_funding",
    "waiting_room_unique_visitors", "qualified_entries", "unique_live_racers",
    "waiting_to_registration_rate", "registration_to_race_rate",
    "winner_x_username", "winner_elapsed_ms", "winner_verified_at", "claimed_at",
    "funding_tx_signature", "claim_tx_signature", "host_share_post_id",
  ];
  const lines = [header.map(csvCell).join(",")];
  for (const row of rows) {
    lines.push([
      row.slug, row.orbId, new Date(row.fundedAt).toISOString(), new Date(row.startsAt).toISOString(), new Date(row.endsAt).toISOString(), row.hostXUsername,
      row.tokenSymbol, row.prizeUsd, row.prizeTokenAmount, row.feeUsd,
      row.waitingRoomVisitors, row.qualifiedEntries, row.liveRacers,
      row.waitingRoomVisitors ? row.qualifiedEntries / row.waitingRoomVisitors : "",
      row.qualifiedEntries ? row.liveRacers / row.qualifiedEntries : "",
      row.winnerXUsername || "", row.winnerVerifiedElapsedMs ?? "", row.winnerVerifiedAt || "", row.claimedAt || "",
      row.fundingTxSignature, row.claimTxSignature || "", row.hostSharePostId || "",
    ].map(csvCell).join(","));
  }
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(lines.join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="orbs-lifetime-metrics-${stamp}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
