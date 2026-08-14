"use client";

import React, { useEffect, useMemo, useState } from "react";
import { ConnectionProvider, WalletProvider as AdapterWalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { LedgerWalletAdapter, PhantomWalletAdapter, SolflareWalletAdapter } from "@solana/wallet-adapter-wallets";
import { WalletConnectWalletAdapter } from "@solana/wallet-adapter-walletconnect";
import {
  SolanaMobileWalletAdapter,
  createDefaultAddressSelector,
  createDefaultAuthorizationResultCache,
  createDefaultWalletNotFoundHandler,
} from "@solana-mobile/wallet-adapter-mobile";
import { WalletAdapterNetwork, type Adapter } from "@solana/wallet-adapter-base";
import { clusterApiUrl } from "@solana/web3.js";
import { IosSafariDeepLinkWalletAdapter } from "@/lib/iosDeepLinkWalletAdapter";

const RPC = process.env.NEXT_PUBLIC_SOLANA_RPC_URL?.trim() || clusterApiUrl("mainnet-beta");
const WALLETCONNECT_PROJECT_ID = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID?.trim() || "";

function androidChromium() {
  try {
    const u = navigator.userAgent.toLowerCase();
    return u.includes("android") && !u.includes("; wv)") && (u.includes("chrome/") || u.includes("chromium/"));
  } catch {
    return false;
  }
}

function iosWebKitBrowser() {
  try {
    const u = navigator.userAgent.toLowerCase();
    const ios = /iphone|ipad|ipod/.test(u) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    if (!ios) return false;

    // Wallet in-app browsers normally inject a Solana provider. Keep using the
    // existing injected adapters there; WalletConnect is for Safari/Chrome/etc.
    const injected = window as Window & {
      solana?: unknown;
      phantom?: { solana?: unknown };
      solflare?: unknown;
      backpack?: unknown;
    };
    return !(injected.solana || injected.phantom?.solana || injected.solflare || injected.backpack);
  } catch {
    return false;
  }
}

export default function SolanaWalletProvider({ children }: { children: React.ReactNode }) {
  const [origin, setOrigin] = useState<string | null>(null);
  const [iosBrowser, setIosBrowser] = useState(false);

  useEffect(() => {
    setOrigin(window.location.origin || "https://orbs.meme");
    setIosBrowser(iosWebKitBrowser());
  }, []);

  const wallets = useMemo<Adapter[]>(() => {
    // Preserve the already-working desktop and wallet-in-app-browser behavior.
    // Ordinary iOS browsers get dedicated Safari-returning universal-link adapters
    // below; every other platform keeps the existing adapters exactly as before.
    const adapters: Adapter[] = iosBrowser
      ? []
      : [
          new PhantomWalletAdapter(),
          new SolflareWalletAdapter({ network: WalletAdapterNetwork.Mainnet }),
          new LedgerWalletAdapter(),
        ];

    // Preserve the already-working Android/Seeker Mobile Wallet Adapter path.
    if (origin && androidChromium()) {
      adapters.push(
        new SolanaMobileWalletAdapter({
          addressSelector: createDefaultAddressSelector(),
          appIdentity: { name: "Orbs", uri: origin, icon: "/orbs-logo-128.png" },
          authorizationResultCache: createDefaultAuthorizationResultCache(),
          cluster: "mainnet-beta",
          onWalletNotFound: createDefaultWalletNotFoundHandler(),
        }),
      );
    }

    // iOS Safari/Chrome cannot use Solana MWA. Use the wallets' official encrypted
    // universal-link provider methods so Safari remains the Orbs/X home and the
    // wallet app opens only for approval/signing. WalletConnect remains a fallback
    // for additional compatible wallets.
    if (origin && iosBrowser) {
      const phantomVisual = new PhantomWalletAdapter();
      const solflareVisual = new SolflareWalletAdapter({ network: WalletAdapterNetwork.Mainnet });

      adapters.push(
        new IosSafariDeepLinkWalletAdapter({
          kind: "phantom",
          name: "Phantom",
          url: phantomVisual.url,
          icon: phantomVisual.icon,
        }),
        new IosSafariDeepLinkWalletAdapter({
          kind: "solflare",
          name: "Solflare",
          url: solflareVisual.url,
          icon: solflareVisual.icon,
        }),
      );

      if (WALLETCONNECT_PROJECT_ID) {
        adapters.push(
          new WalletConnectWalletAdapter({
            network: WalletAdapterNetwork.Mainnet,
            options: {
              relayUrl: "wss://relay.walletconnect.com",
              projectId: WALLETCONNECT_PROJECT_ID,
              metadata: {
                name: "Orbs.meme",
                description: "Create, play, and claim Orbs on Solana",
                url: origin,
                icons: [`${origin}/orbs-logo-128.png`],
              },
            },
          }),
        );
      }
    }

    return adapters;
  }, [origin, iosBrowser]);

  return (
    <ConnectionProvider endpoint={RPC}>
      <AdapterWalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </AdapterWalletProvider>
    </ConnectionProvider>
  );
}
