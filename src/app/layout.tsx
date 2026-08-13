import type { Metadata, Viewport } from "next";
import "@solana/wallet-adapter-react-ui/styles.css";
import "./globals.css";
import AppProviders from "@/components/AppProviders";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import { canonicalPublicSiteUrl } from "@/lib/siteUrl";

const site = canonicalPublicSiteUrl();

export const metadata: Metadata = {
  metadataBase: new URL(site),
  title: { default: "Orbs — Play. Win. Grow.", template: "%s · Orbs" },
  description: "Put up a reward. Drop an Orb. Grow your community.",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: "/favicon.png",
    apple: "/orbs-logo-256.png",
  },
  appleWebApp: {
    capable: true,
    title: "Orbs",
    statusBarStyle: "black-translucent",
  },
  openGraph: {
    title: "Orbs — Play. Win. Grow.",
    description: "Create a live marble challenge for your community. Fund the prize with a Solana token. First valid finish wins.",
    siteName: "Orbs",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Orbs — Play. Win. Grow.",
    description: "Put up a reward. Drop an Orb. Grow your community.",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F7F8FC" },
    { media: "(prefers-color-scheme: dark)", color: "#050817" },
  ],
};

const script = `(function(){try{var s=localStorage.getItem('orbs-theme');var d=s?s==='dark':matchMedia('(prefers-color-scheme: dark)').matches;document.documentElement.classList.toggle('dark',d)}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Lato:wght@600;700;900&display=swap" rel="stylesheet" />
        <script dangerouslySetInnerHTML={{ __html: script }} />
      </head>
      <body>
        <AppProviders>
          <div className="shell">
            <SiteHeader />
            <main>{children}</main>
            <SiteFooter />
          </div>
        </AppProviders>
      </body>
    </html>
  );
}
