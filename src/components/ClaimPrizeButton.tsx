"use client";

import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { Connection, PublicKey, Transaction } from "@solana/web3.js";
import { assertReviewedClaimTransaction } from "@/lib/orbsClaimFirewall";

async function payload<T>(response: Response): Promise<T> {
  const text = await response.text();
  try { return JSON.parse(text) as T; } catch { throw new Error(response.ok ? "Invalid server response" : `Server error (${response.status})`); }
}

export default function ClaimPrizeButton({ slug, winnerWallet, hostWallet, mint, orbId, claimed }: {
  slug: string;
  winnerWallet: string;
  hostWallet: string;
  mint: string;
  orbId: string;
  claimed?: boolean;
}) {
  const { publicKey, signTransaction } = useWallet();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const isWinnerWallet = publicKey?.toBase58() === winnerWallet;

  const claim = async () => {
    if (!publicKey || !signTransaction || !isWinnerWallet) return;
    setBusy(true); setMessage(null);
    try {
      const rpc = (process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "").trim();
      if (!rpc) throw new Error("NEXT_PUBLIC_SOLANA_RPC_URL is not configured");
      const response = await fetch(`/api/orbs/${encodeURIComponent(slug)}/claim`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet: publicKey.toBase58() }),
      });
      const result = await payload<{ ok?: boolean; claim?: { transactionBase64: string; blockhash: string; lastValidBlockHeight: number; claimAuthority: string }; error?: string }>(response);
      if (!response.ok || !result.ok || !result.claim) throw new Error(result.error || "Could not prepare claim");
      const tx = Transaction.from(Uint8Array.from(atob(result.claim.transactionBase64), (char) => char.charCodeAt(0)));
      assertReviewedClaimTransaction(tx, {
        host: new PublicKey(hostWallet),
        winner: publicKey,
        mint: new PublicKey(mint),
        orbIdHex: orbId,
        claimAuthority: new PublicKey(result.claim.claimAuthority),
      });
      const signed = await signTransaction(tx);
      const connection = new Connection(rpc, "confirmed");
      const signature = await connection.sendRawTransaction(signed.serialize(), { skipPreflight: false, maxRetries: 3 });
      const confirmed = await connection.confirmTransaction({
        signature,
        blockhash: result.claim.blockhash,
        lastValidBlockHeight: result.claim.lastValidBlockHeight,
      }, "confirmed");
      if (confirmed.value.err) throw new Error("Solana rejected the prize claim");
      const confirm = await fetch(`/api/orbs/${encodeURIComponent(slug)}/claim/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet: publicKey.toBase58(), signature }),
      });
      const confirmedPayload = await payload<{ ok?: boolean; error?: string }>(confirm);
      if (!confirm.ok || !confirmedPayload.ok) throw new Error(confirmedPayload.error || "Prize moved on-chain but confirmation could not be recorded");
      setMessage(`Prize claimed · ${signature.slice(0, 8)}…`);
      window.setTimeout(() => window.location.reload(), 900);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not claim prize");
    } finally { setBusy(false); }
  };

  if (claimed) return <div><button className="btn-primary" disabled>Prize claimed ✓</button></div>;
  return <div>
    <button className="btn-primary" disabled={!isWinnerWallet || !signTransaction || busy} onClick={() => void claim()}>
      {busy ? "Securing Turnkey + wallet signatures…" : isWinnerWallet ? "Claim prize" : "Connect the winning wallet to claim"}
    </button>
    {message ? <p className="muted" style={{marginTop:12}}>{message}</p> : null}
  </div>;
}
