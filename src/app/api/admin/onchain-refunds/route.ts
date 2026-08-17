import { NextResponse } from "next/server";
import { getAdminSession } from "@/lib/adminAuth";
import { getOrbRecord, recordRefundSettlement } from "@/lib/orbStore";
import {
  buildOnchainRefundTransaction,
  scanRefundableOnchainOrbs,
  verifyOnchainRefundClosed,
} from "@/lib/orbsProgram";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function requireAdmin() {
  const session = await getAdminSession();
  if (!session) throw new Error("Admin authentication required");
  return session;
}

export async function GET() {
  try {
    await requireAdmin();
    const escrows = await scanRefundableOnchainOrbs();
    return NextResponse.json(
      { ok: true, escrows, scannedAt: Date.now() },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not scan on-chain escrows";
    return NextResponse.json({ ok: false, error: message }, { status: message === "Admin authentication required" ? 401 : 400 });
  }
}

export async function POST(request: Request) {
  try {
    await requireAdmin();
    const body = await request.json().catch(() => null) as { orbPda?: unknown; slug?: unknown } | null;
    const orbPda = typeof body?.orbPda === "string" ? body.orbPda.trim() : "";
    const slug = typeof body?.slug === "string" ? body.slug.trim() : "";
    if (!orbPda) return NextResponse.json({ ok: false, error: "orbPda is required" }, { status: 400 });

    // Re-read and validate every identity/refund condition immediately before signing.
    // The refund instruction itself is permissionless and Anchor hard-binds the destination
    // to the original host's canonical ATA.
    const built = await buildOnchainRefundTransaction(orbPda);
    const signature = await built.connection.sendRawTransaction(built.tx.serialize(), {
      skipPreflight: false,
      maxRetries: 3,
    });
    const confirmation = await built.connection.confirmTransaction({ signature, ...built.latest }, "confirmed");
    if (confirmation.value.err) throw new Error("Solana rejected the expired-Orb refund transaction");
    await verifyOnchainRefundClosed(built.connection, built.orbPda, built.prizeVault);

    // If this historical escrow still has a Redis record, keep the dashboard/user history
    // in sync. Unknown/orphaned Orb IDs intentionally do not block the on-chain recovery.
    if (slug) {
      const record = await getOrbRecord(slug).catch(() => null);
      if (record?.id.toLowerCase() === built.decoded.orbIdHex.toLowerCase()) {
        await recordRefundSettlement(slug, signature).catch((error) =>
          console.warn("[orbs:admin-refund] On-chain refund succeeded but DB receipt persistence failed", error),
        );
      }
    }

    return NextResponse.json(
      {
        ok: true,
        signature,
        orbPda: built.orbPda.toBase58(),
        host: built.decoded.host.toBase58(),
        mint: built.decoded.mint.toBase58(),
        refundedRawAmount: built.vaultAmount.toString(),
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not refund expired Orb";
    return NextResponse.json({ ok: false, error: message }, { status: message === "Admin authentication required" ? 401 : 400 });
  }
}
