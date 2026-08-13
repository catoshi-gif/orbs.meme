import { ImageResponse } from "next/og";
import sharp from "sharp";
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

function safeRemoteImage(value: string | null | undefined, kind: "token" | "avatar") {
  if (!value) return null;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    const tokenHosts = ["static.jup.ag", "jup.ag", "arweave.net", "ipfs.io", "gateway.pinata.cloud", "raw.githubusercontent.com"];
    const avatarHosts = ["pbs.twimg.com"];
    const allowed = kind === "token" ? tokenHosts : avatarHosts;
    return url.protocol === "https:" && allowed.some((domain) => host === domain || host.endsWith(`.${domain}`)) ? url.toString() : null;
  } catch { return null; }
}

async function loadRemoteImage(value: string | null) {
  if (!value) return null;
  try {
    const response = await fetch(value, { cache: "force-cache", signal: AbortSignal.timeout(3_000) });
    const type = (response.headers.get("content-type") || "").split(";")[0].toLowerCase();
    if (!response.ok || !["image/jpeg", "image/png", "image/webp"].includes(type)) return null;
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.length || bytes.length > 2_000_000) return null;
    return `data:${type};base64,${bytes.toString("base64")}`;
  } catch { return null; }
}

function difficultyLabel(value: string) {
  if (value === "quick") return "EASY / ~5 MIN";
  if (value === "brutal") return "HARD / ~15 MIN";
  return "MEDIUM / ~10 MIN";
}

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
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
  const [tokenLogo, hostAvatar] = await Promise.all([
    loadRemoteImage(safeRemoteImage(orb.token.logoURI, "token")),
    loadRemoteImage(safeRemoteImage(orb.hostX.profileImageUrl, "avatar")),
  ]);
  const origin = new URL(request.url).origin;
  const brandLogo = `${origin}/orbs-logo-128.png`;
  const background = `${origin}/orbs-share-bg.jpg`;
  const launch = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(orb.startsAt);
  const prizeFontSize = tokenAmount.length + tokenSymbol.length > 18 ? 55 : 68;

  const png = new ImageResponse(
    <div style={{
      width: "100%", height: "100%", display: "flex", position: "relative", overflow: "hidden",
      color: "#F8FAFF", background: "#030617", fontFamily: "sans-serif",
    }}>
      <img src={background} alt="" width={1200} height={630} style={{ position: "absolute", left: 112, top: 0, width: 1200, height: 630, objectFit: "cover" }} />
      <div style={{ position: "absolute", inset: 0, display: "flex", background: "linear-gradient(90deg,rgba(2,5,20,.98) 0%,rgba(3,7,25,.94) 39%,rgba(4,7,24,.62) 61%,rgba(3,5,19,.20) 100%)" }} />
      <div style={{ position: "absolute", inset: 0, display: "flex", background: "linear-gradient(0deg,rgba(2,5,18,.88) 0%,transparent 34%,rgba(3,5,18,.28) 100%)" }} />
      <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 8, display: "flex", background: "linear-gradient(180deg,#6C5CFF,#9B5CFF 46%,#20E3D2)" }} />

      <div style={{ position: "relative", width: "100%", display: "flex", flexDirection: "column", padding: "40px 52px 38px 60px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 13 }}>
            <img src={brandLogo} alt="" width={58} height={58} style={{ width: 58, height: 58, objectFit: "contain", filter: "drop-shadow(0 0 18px #5B5CF6AA)" }} />
            <div style={{ display: "flex", fontSize: 31, fontWeight: 900, letterSpacing: -1.2 }}>orbs<span style={{ color: "#8D70FF" }}>.meme</span></div>
          </div>
          <div style={{ display: "flex", color: "#D9DDF5", fontSize: 15, fontWeight: 800, letterSpacing: 3 }}>PLAY / WIN / GROW</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", width: 720, marginTop: 68 }}>
          <div style={{ display: "flex", color: "#76F4EA", fontSize: 16, fontWeight: 900, letterSpacing: 2.4, marginBottom: 13 }}>SEALED SOLANA REWARD RACE</div>
          <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
            <div style={{ width: 100, height: 100, borderRadius: 999, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", background: `radial-gradient(circle at 35% 30%, #fff, ${orb.style.marbleSecondary} 18%, ${orb.style.marble} 62%, ${orb.style.floor})`, border: "3px solid #FFFFFF55", boxShadow: `0 0 44px ${orb.style.marble}99` }}>
              {tokenLogo ? <img src={tokenLogo} alt="" width={100} height={100} style={{ width: 100, height: 100, objectFit: "cover" }} /> : <span style={{ fontSize: 38, fontWeight: 900 }}>{tokenSymbol.slice(0, 2)}</span>}
            </div>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <div style={{ display: "flex", alignItems: "baseline", fontSize: prizeFontSize, lineHeight: 0.98, fontWeight: 900, letterSpacing: -3, textShadow: "0 5px 28px #000000AA" }}>{tokenAmount}<span style={{ marginLeft: 15, color: "#FFFFFFD9" }}>{tokenSymbol}</span></div>
              <div style={{ display: "flex", marginTop: 10, color: "#C4CCE3", fontSize: 25, fontWeight: 700 }}>{money(orb.prizeUsd)} winner prize</div>
            </div>
          </div>
          <div style={{ display: "flex", marginTop: 24, fontSize: 31, fontWeight: 900, letterSpacing: -0.8 }}>FIRST VERIFIED FINISH WINS.</div>
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: "auto", borderTop: "1px solid #FFFFFF2B", paddingTop: 22 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 13 }}>
            <div style={{ width: 52, height: 52, borderRadius: 999, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", background: "linear-gradient(135deg,#655BFF,#20E3D2)", border: "2px solid #FFFFFF66" }}>
              {hostAvatar ? <img src={hostAvatar} alt="" width={52} height={52} style={{ width: 52, height: 52, objectFit: "cover" }} /> : <span style={{ color: "#FFFFFF", fontSize: 22, fontWeight: 900 }}>@</span>}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <div style={{ display: "flex", color: "#AEB8D2", fontSize: 14, fontWeight: 800, letterSpacing: 1.4 }}>HOSTED BY</div>
              <div style={{ display: "flex", color: "#FFFFFF", fontSize: 22, fontWeight: 900 }}>@{orb.hostX.username}</div>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 7 }}>
            <div style={{ display: "flex", color: "#7FF9EE", fontSize: 22, fontWeight: 900, letterSpacing: .4 }}>JOIN THE WAITING ROOM &gt;</div>
            <div style={{ display: "flex", color: "#B3BDD6", fontSize: 16, fontWeight: 700 }}>{difficultyLabel(orb.difficulty)} / {launch}</div>
          </div>
        </div>
      </div>
    </div>,
    { width, height },
  );

  const jpeg = await sharp(Buffer.from(await png.arrayBuffer()))
    .jpeg({ quality: 82, chromaSubsampling: "4:4:4", progressive: true, mozjpeg: true })
    .toBuffer();

  return new Response(new Uint8Array(jpeg), {
    headers: {
      "Content-Type": "image/jpeg",
      "Content-Disposition": `inline; filename="orbs-${slug}.jpg"`,
      "Cache-Control": "public, max-age=86400, s-maxage=31536000, stale-while-revalidate=604800",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
