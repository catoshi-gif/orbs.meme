import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { cache } from "react";
import { getPublicOrb } from "@/lib/orbStore";
import { canonicalPublicSiteUrl } from "@/lib/siteUrl";
import { getWinner } from "@/lib/upstashWinner";

export const dynamic = "force-dynamic";
const site = canonicalPublicSiteUrl();
const loadOrb = cache(getPublicOrb);

function amount(value: number) {
  return value.toLocaleString("en-US", { maximumFractionDigits: 6 });
}
function formatTime(ms?: number) {
  if (!ms || !Number.isFinite(ms)) return "—";
  const min = Math.floor(ms / 60000);
  const sec = Math.floor((ms % 60000) / 1000);
  const millis = Math.floor(ms % 1000);
  return `${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const orb = await loadOrb(slug);
  const winner = orb ? await getWinner(orb.id) : null;
  if (!orb || !winner?.claimTxSignature || !winner.claimedAt) return { title: "Verified win not found" };

  const prize = `${amount(orb.prizeTokenAmount)} ${orb.token.symbol}`;
  const username = winner.xUsername ? `@${winner.xUsername}` : "Verified winner";
  const title = `${username} Won ${prize} on Orbs`;
  const description = `Verified skill-competition win. Finish: ${formatTime(winner.verifiedElapsedMs)}. Prize claimed onchain.`;
  const canonical = `${site}/orb/${encodeURIComponent(slug)}/winner`;
  const image = `${site}/api/orbs/${encodeURIComponent(slug)}/winner-card?v=${winner.claimedAt}`;

  return {
    title,
    description,
    alternates: { canonical },
    openGraph: {
      title,
      description,
      type: "website",
      url: canonical,
      siteName: "orbs.meme",
      images: [{ url: image, width: 1200, height: 630, alt: `${username} verified Orbs winner card`, type: "image/jpeg" }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [{ url: image, alt: `${username} verified Orbs winner card` }],
    },
    other: {
      "twitter:url": canonical,
      "twitter:image:width": "1200",
      "twitter:image:height": "630",
    },
  };
}

export default async function WinnerPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const orb = await loadOrb(slug);
  const winner = orb ? await getWinner(orb.id) : null;

  if (!orb || !winner?.claimTxSignature || !winner.claimedAt) {
    return <div className="page"><div className="container"><div className="result">
      <Image src="/orbs-logo-256.png" width={180} height={180} alt="Orbs" />
      <span className="eyebrow">Verified Result</span>
      <h1>This win is not available.</h1>
      <Link className="btn-secondary" href={`/orb/${slug}`}>Back to Orb</Link>
    </div></div></div>;
  }

  const prize = `${amount(orb.prizeTokenAmount)} ${orb.token.symbol}`;
  return <div className="page"><div className="container"><div className="result">
    <Image src="/orbs-logo-256.png" width={180} height={180} alt="Orbs" />
    <span className="eyebrow">Verified Contest Winner</span>
    <h1>{winner.xUsername ? `@${winner.xUsername} won the Orb.` : "The Orb has a verified winner."}</h1>
    <p className="muted">This skill-competition result was server verified and the prize was claimed onchain.</p>
    <div className="result-prize gradient-text">{prize}</div>
    <div className="metrics">
      <div className="metric"><span>Winner</span><strong>{winner.xUsername ? `@${winner.xUsername}` : "Verified winner"}</strong></div>
      <div className="metric"><span>Verified finish</span><strong>{formatTime(winner.verifiedElapsedMs)}</strong></div>
      <div className="metric"><span>Status</span><strong>Prize claimed onchain</strong></div>
    </div>
    <div className="hero-actions" style={{ justifyContent: "center" }}>
      <Link className="btn-primary" href="/create">Create an Orb</Link>
      <Link className="btn-ghost" href={`/orb/${slug}/results`}>View Public Result →</Link>
    </div>
  </div></div></div>;
}
