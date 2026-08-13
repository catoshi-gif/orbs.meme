import Link from "next/link";
import type { Metadata } from "next";
import { cache } from "react";
import OrbQualification from "@/components/OrbQualification";
import OrbLobbyHero from "@/components/OrbLobbyHero";
import { getPublicOrb } from "@/lib/orbStore";

export const dynamic = "force-dynamic";
const loadOrb = cache(getPublicOrb);

function amount(value: number) { return value.toLocaleString("en-US", { maximumFractionDigits: 6 }); }
function money(value: number) { return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(value); }

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const orb = await loadOrb(slug);
  if (!orb) return { title: "Orb not found" };
  const title = `${amount(orb.prizeTokenAmount)} ${orb.token.symbol.slice(0, 16)} Orb by @${orb.hostX.username}`;
  const description = `${money(orb.prizeUsd)} prize. Join the waiting room, qualify, and race the same sealed maze. First verified finish wins.`;
  const image = `/api/orbs/${encodeURIComponent(slug)}/share-card`;
  return {
    title,
    description,
    alternates: { canonical: `/orb/${slug}` },
    openGraph: { title, description, type: "website", url: `/orb/${slug}`, images: [{ url: image, width: 1200, height: 630, alt: `${title} — join the waiting room` }] },
    twitter: { card: "summary_large_image", title, description, images: [image] },
  };
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const orb = await loadOrb(slug);
  if (!orb) {
    return <div className="page"><div className="container"><div className="lobby"><section className="card prize-hero"><div className="orb-top"><div className="hostline"><span className="avatar"/>Orbs Glass Roller demo</div><span className="pill live">DEMO</span></div><div className="prize-big">Play. Win. Grow.</div><div className="muted">The public demo uses a URL-derived seed and carries no prize.</div><div style={{marginTop:18}}><Link className="btn-primary" href={`/orb/${slug}/play?difficulty=quick`}>Play Glass Roller demo →</Link></div></section><aside className="card qualify"><span className="eyebrow">Demo mode</span><h3>No qualification required.</h3><p className="muted">Create a sealed test Orb from the Create page to exercise X follow confirmation, countdown gating and the hidden-seed lifecycle.</p><Link className="btn-secondary" href="/create">Create a test Orb →</Link></aside></div></div></div>;
  }
  return <div className="page"><div className="container"><div className="lobby"><OrbLobbyHero orb={orb}/><OrbQualification slug={slug} hostXId={orb.hostX.id} hostUsername={orb.hostX.username} startsAt={orb.startsAt} prizeTokenAmount={orb.prizeTokenAmount} prizeUsd={orb.prizeUsd} tokenSymbol={orb.token.symbol}/></div></div></div>;
}
