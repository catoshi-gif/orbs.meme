import { ImageResponse } from "next/og";
import { getPublicOrb } from "@/lib/orbStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const width = 1200;
const height = 630;

function amount(value: number) {
  return value.toLocaleString("en-US", { maximumFractionDigits: 6 });
}

function money(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(value);
}

function safeLogo(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    const allowed = ["static.jup.ag", "jup.ag", "arweave.net", "ipfs.io", "gateway.pinata.cloud", "raw.githubusercontent.com"];
    return url.protocol === "https:" && allowed.some((domain) => host === domain || host.endsWith(`.${domain}`)) ? url.toString() : null;
  } catch { return null; }
}

function difficultyLabel(value: string) {
  if (value === "quick") return "EASY · ~5 MIN";
  if (value === "brutal") return "HARD · ~15 MIN";
  return "MEDIUM · ~10 MIN";
}

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const orb = await getPublicOrb(slug);
  if (!orb) {
    return new ImageResponse(<div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#050817", color: "#ffffff", fontSize: 64, fontWeight: 900 }}>ORB NOT FOUND</div>, { width, height, status: 404 });
  }

  const exactTokenAmount = amount(orb.prizeTokenAmount);
  const tokenAmount = exactTokenAmount.length > 22
    ? new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 4 }).format(orb.prizeTokenAmount)
    : exactTokenAmount;
  const tokenSymbol = orb.token.symbol.slice(0, 16);
  const logo = safeLogo(orb.token.logoURI);
  const launch = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(orb.startsAt);
  const prizeFontSize = tokenAmount.length + tokenSymbol.length > 18 ? 62 : 78;

  return new ImageResponse(
    <div style={{
      width: "100%", height: "100%", display: "flex", position: "relative", overflow: "hidden",
      color: "#F8FAFF", background: "#070B1A",
      backgroundImage: `radial-gradient(circle at 82% 18%, ${orb.style.marbleSecondary}66 0%, transparent 31%), radial-gradient(circle at 16% 92%, ${orb.style.accent}44 0%, transparent 34%), linear-gradient(130deg, #070B1A 0%, #101832 52%, #071A24 100%)`,
      padding: "54px 60px", fontFamily: "sans-serif",
    }}>
      <div style={{ position: "absolute", width: 410, height: 410, borderRadius: 999, right: -86, top: -122, border: `2px solid ${orb.style.walls}88`, boxShadow: `0 0 90px ${orb.style.accent}55`, display: "flex" }} />
      <div style={{ position: "absolute", width: 250, height: 250, borderRadius: 999, right: 24, top: -34, border: `1px solid ${orb.style.marbleSecondary}99`, display: "flex" }} />
      <div style={{ width: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div style={{ width: 52, height: 52, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 999, background: "linear-gradient(135deg,#5B5CF6,#9A5CFF 50%,#20E3D2)", boxShadow: "0 0 30px #5B5CF688" }}><div style={{ width: 34, height: 14, display: "flex", border: "2px solid #FFFFFFDD", borderRadius: 999, transform: "rotate(-24deg)" }} /></div>
            <div style={{ display: "flex", fontSize: 30, fontWeight: 900, letterSpacing: -1 }}>orbs<span style={{ color: "#8A70FF" }}>.meme</span></div>
          </div>
          <div style={{ display: "flex", padding: "11px 19px", borderRadius: 999, border: "1px solid #20E3D288", background: "#20E3D21A", color: "#7FF9EE", fontSize: 16, fontWeight: 800, letterSpacing: 1.6 }}>SEALED · FREE TO ENTER</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", maxWidth: 940 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 24, marginBottom: 18 }}>
            <div style={{ width: 104, height: 104, borderRadius: 999, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", background: `radial-gradient(circle at 35% 30%, #fff, ${orb.style.marbleSecondary} 18%, ${orb.style.marble} 62%, ${orb.style.floor})`, border: "2px solid #FFFFFF33", boxShadow: `0 0 44px ${orb.style.marble}99` }}>
              {logo ? <img src={logo} alt="" width="104" height="104" style={{ objectFit: "cover" }} /> : <span style={{ fontSize: 42, fontWeight: 900 }}>{tokenSymbol.slice(0, 2)}</span>}
            </div>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <div style={{ display: "flex", alignItems: "baseline", fontSize: prizeFontSize, lineHeight: 0.96, fontWeight: 900, letterSpacing: -3 }}>{tokenAmount} <span style={{ marginLeft: 18, color: "#FFFFFFC9" }}>{tokenSymbol}</span></div>
              <div style={{ display: "flex", marginTop: 12, color: "#B7C2DD", fontSize: 28, fontWeight: 700 }}>~ {money(orb.prizeUsd)} winner prize</div>
            </div>
          </div>
          <div style={{ display: "flex", fontSize: 38, fontWeight: 900, letterSpacing: -1.2 }}>FIRST VERIFIED FINISH WINS.</div>
        </div>

        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", borderTop: "1px solid #FFFFFF22", paddingTop: 24 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            <div style={{ display: "flex", color: "#FFFFFF", fontSize: 24, fontWeight: 800 }}>Hosted by @{orb.hostX.username}</div>
            <div style={{ display: "flex", color: "#9EABC8", fontSize: 18 }}>{difficultyLabel(orb.difficulty)} · Launches {launch}</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 13, color: "#7FF9EE", fontSize: 24, fontWeight: 900 }}>JOIN THE WAITING ROOM <span style={{ fontSize: 32 }}>&gt;</span></div>
        </div>
      </div>
    </div>,
    {
      width,
      height,
      headers: { "Cache-Control": "public, max-age=86400, s-maxage=31536000, stale-while-revalidate=604800" },
    },
  );
}
