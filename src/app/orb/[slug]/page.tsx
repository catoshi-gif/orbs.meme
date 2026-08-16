import Link from "next/link";
import type { Metadata } from "next";
import { cache } from "react";
import OrbQualification from "@/components/OrbQualification";
import OrbLobbyHero from "@/components/OrbLobbyHero";
import { getPublicOrb, orbGameType } from "@/lib/orbStore";
import { canonicalPublicSiteUrl } from "@/lib/siteUrl";
import { getWinner } from "@/lib/upstashWinner";

export const dynamic = "force-dynamic";
const loadOrb = cache(getPublicOrb);
const site = canonicalPublicSiteUrl();

function amount(value: number) { return value.toLocaleString("en-US", { maximumFractionDigits: 6 }); }
function money(value: number) { return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(value); }

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const orb = await loadOrb(slug);
  if (!orb) return { title: "Orb not found" };
  const title = `${amount(orb.prizeTokenAmount)} ${orb.token.symbol.slice(0, 16)} Orb by @${orb.hostX.username}`;
  const gameType = orbGameType(orb);
  const description = gameType === "arena" ? `${money(orb.prizeUsd)} prize. Join the waiting room, choose your Orb colors, and enter the live ARENA.` : `${money(orb.prizeUsd)} prize. Join the waiting room and race the same sealed MAZE. First verified finish wins.`;
  const canonical = `${site}/orb/${encodeURIComponent(slug)}`;
  const image = `${site}/api/orbs/${encodeURIComponent(slug)}/share-card?v=${orb.createdAt}`;
  return {
    title,
    description,
    alternates: { canonical },
    openGraph: { title, description, type: "website", url: canonical, siteName: "orbs.meme", images: [{ url: image, width: 1200, height: 630, alt: `${title} — join the waiting room`, type: "image/jpeg" }] },
    twitter: { card: "summary_large_image", title, description, images: [{ url: image, alt: `${title} — join the waiting room` }] },
    other: {
      "twitter:url": canonical,
      "twitter:image:width": "1200",
      "twitter:image:height": "630",
    },
  };
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const orb = await loadOrb(slug);
  if (!orb) {
    return <div className="page"><div className="container"><div className="lobby"><section className="card prize-hero"><div className="orb-top"><div className="hostline"><span className="avatar"/>Orbs MAZE demo</div><span className="pill live">DEMO</span></div><div className="prize-big">MAZE demo.</div><div className="muted">The public demo uses a URL-derived seed and carries no prize.</div><div style={{marginTop:18}}><Link className="btn-primary" href={`/orb/${slug}/play?difficulty=quick`}>Play MAZE demo →</Link></div></section><aside className="card qualify"><span className="eyebrow">Demo mode</span><h3>No qualification required.</h3><p className="muted">Create a sealed test Orb from the Create page to exercise X follow confirmation, countdown gating and the hidden-seed lifecycle.</p><Link className="btn-secondary" href="/create">Create a test Orb →</Link></aside></div></div></div>;
  }
  const winner = await getWinner(orb.id);
  const closed = Boolean(winner) || Date.now() >= orb.endsAt;
  return <div className="page"><div className="container"><div className="lobby"><OrbLobbyHero orb={orb} winner={Boolean(winner)}/>{closed ? <aside className="card qualify orb-closed-card"><span className="eyebrow">Competition closed</span><h3>{winner ? "A verified winner cleared this Orb." : "This Orb expired without a winner."}</h3><p className="muted">New entries are closed. The verified result is available now.</p><Link className="btn-primary" href={`/orb/${slug}/results`}>View result →</Link></aside> : <OrbQualification slug={slug} hostXId={orb.hostX.id} hostUsername={orb.hostX.username} createdAt={orb.createdAt} startsAt={orb.startsAt} endsAt={orb.endsAt} prizeTokenAmount={orb.prizeTokenAmount} prizeUsd={orb.prizeUsd} tokenSymbol={orb.token.symbol} gameType={orbGameType(orb)}/>}</div></div></div>;
}
