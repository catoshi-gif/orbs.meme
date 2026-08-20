"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import Logo from "@/components/Logo";
import SocialLinks from "@/components/SocialLinks";

export default function SiteFooter() {
  const pathname = usePathname();
  if (/\/orb\/[^/]+\/play/.test(pathname || "")) return null;

  return (
    <footer>
      <div className="footer-inner">
        <div className="footer-brand">
          <Logo />
          <p>Where online communities play for their tokens.</p>
          <SocialLinks />
        </div>
        <div className="footer-links">
          <Link href="/how-it-works">How it works</Link>
          <Link href="/rules">Rules</Link>
          <Link href="/fair-play">Fair Play</Link>
          <Link href="/terms">Terms</Link>
          <Link href="/privacy">Privacy</Link>
        </div>
      </div>
    </footer>
  );
}
