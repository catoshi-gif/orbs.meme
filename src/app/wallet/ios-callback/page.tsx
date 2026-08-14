"use client";

import { useEffect, useState } from "react";

const CALLBACK_PREFIX = "orbs:ios-wallet:callback:";

export default function IosWalletCallbackPage() {
  const [status, setStatus] = useState("Returning to Orbs…");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const operationId = params.get("op");
    if (!operationId) {
      setStatus("This wallet callback is missing its request ID. You can close this tab.");
      return;
    }

    const payload: Record<string, string> = {};
    params.forEach((value, key) => {
      if (key !== "op" && key !== "wallet") payload[key] = value;
    });

    const storageKey = `${CALLBACK_PREFIX}${operationId}`;
    try {
      localStorage.setItem(storageKey, JSON.stringify(payload));
    } catch {
      // BroadcastChannel below is the primary bridge.
    }

    try {
      const channel = new BroadcastChannel(`${CALLBACK_PREFIX}${operationId}`);
      channel.postMessage(payload);
      setTimeout(() => channel.close(), 250);
    } catch {
      // storage event / visibility fallback still works.
    }

    setStatus(payload.errorCode || payload.errorMessage ? "Wallet request cancelled." : "Approved. Returning to Orbs…");

    const timer = window.setTimeout(() => {
      window.close();
      // iOS may refuse programmatic close if the browser restored this as the
      // foreground tab. In that case return to the previous Orbs history entry.
      window.setTimeout(() => {
        if (!window.closed && window.history.length > 1) window.history.back();
      }, 250);
    }, 450);

    return () => window.clearTimeout(timer);
  }, []);

  return (
    <main style={{ minHeight: "100dvh", display: "grid", placeItems: "center", padding: 24 }}>
      <div style={{ textAlign: "center", maxWidth: 420 }}>
        <img src="/orbs-logo-128.png" alt="Orbs" width={72} height={72} style={{ borderRadius: 18 }} />
        <h1 style={{ margin: "18px 0 8px" }}>{status}</h1>
        <p style={{ opacity: 0.7, margin: 0 }}>Keep this Safari window open. It should close automatically.</p>
      </div>
    </main>
  );
}
