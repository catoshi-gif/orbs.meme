"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import Logo from "@/components/Logo";
import ThemeToggle from "@/components/ThemeToggle";
import ConnectWallet from "@/components/ConnectWallet";
import SocialLinks from "@/components/SocialLinks";

const links: Array<[string, string]> = [
  ["/", "Live Orbs"],
  ["/leaderboard", "Leaderboard"],
  ["/how-it-works", "How it works"],
  ["/create", "Create"],
];

export default function SiteHeader() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const liveGame = /\/orb\/[^/]+\/play/.test(pathname || "");

  // The live game owns the viewport. Keeping the marketing/site header above the canvas
  // wastes ~64-70px on phones and makes Safari feel even less immersive.
  if (liveGame) return null;

  return (
    <header>
      <div className="header-inner">
        <Logo />
        <nav>
          {links.map(([href, label]) => (
            <Link className={pathname === href ? "active" : ""} key={href} href={href}>
              {label}
            </Link>
          ))}
        </nav>
        <div className="head-actions">
          <div className="social-desktop"><SocialLinks compact /></div>
          <ThemeToggle />
          <div className="wallet-desktop"><ConnectWallet compact /></div>
          <button className="menu-btn" onClick={() => setOpen((value) => !value)} aria-label="Menu" aria-expanded={open}>☰</button>
        </div>
      </div>
      {open ? (
        <div className="mobile-nav">
          {links.map(([href, label]) => (
            <Link key={href} href={href} onClick={() => setOpen(false)}>{label}</Link>
          ))}
          <Link href="/me" onClick={() => setOpen(false)}>My Orbs</Link>
          <div className="mobile-socials"><SocialLinks /></div>
          <ConnectWallet />
        </div>
      ) : null}
    </header>
  );
}
