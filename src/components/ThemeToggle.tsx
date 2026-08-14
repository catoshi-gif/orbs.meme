"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";

type Theme = "dark" | "light";


function walletThemeKey(wallet: string) {
  return `orbs-theme:${wallet}`;
}

function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark");
}

function currentTheme(): Theme {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

export default function ThemeToggle() {
  const { publicKey } = useWallet();
  const wallet = publicKey?.toBase58() || null;
  const [theme, setTheme] = useState<Theme>("dark");
  const loadVersion = useRef(0);

  useEffect(() => {
    setTheme(currentTheme());
  }, []);

  useEffect(() => {
    if (!wallet) return;

    const version = ++loadVersion.current;
    const localKey = walletThemeKey(wallet);
    const local = localStorage.getItem(localKey);
    if (local === "dark" || local === "light") {
      applyTheme(local);
      setTheme(local);
    }

    const controller = new AbortController();
    fetch(`/api/preferences/theme?wallet=${encodeURIComponent(wallet)}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then((response) => response.ok ? response.json() : null)
      .then((payload: { theme?: Theme | null } | null) => {
        if (version !== loadVersion.current) return;
        if (payload?.theme === "dark" || payload?.theme === "light") {
          applyTheme(payload.theme);
          setTheme(payload.theme);
          localStorage.setItem(localKey, payload.theme);
          return;
        }

        // No wallet preference exists yet. Seed it once from the user's current
        // local preference so future visits/devices can restore it after connect.
        const seed = (local === "dark" || local === "light") ? local : currentTheme();
        localStorage.setItem(localKey, seed);
        void fetch("/api/preferences/theme", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ wallet, theme: seed }),
          keepalive: true,
        }).catch(() => {});
      })
      .catch(() => {});

    return () => controller.abort();
  }, [wallet]);

  const toggle = useCallback(() => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    applyTheme(next);
    setTheme(next);

    if (wallet) {
      localStorage.setItem(walletThemeKey(wallet), next);
      void fetch("/api/preferences/theme", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet, theme: next }),
        keepalive: true,
      }).catch(() => {});
    }
  }, [theme, wallet]);

  return (
    <button
      className="icon-btn"
      aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
      title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
      onClick={toggle}
    >
      {theme === "dark" ? "☀" : "☾"}
    </button>
  );
}
