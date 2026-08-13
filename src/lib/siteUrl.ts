const FALLBACK_SITE_URL = "https://www.orbs.meme";

export function canonicalPublicSiteUrl(value = process.env.NEXT_PUBLIC_SITE_URL || FALLBACK_SITE_URL) {
  try {
    const url = new URL(value);
    if (url.hostname.toLowerCase() === "orbs.meme") url.hostname = "www.orbs.meme";
    return url.origin;
  } catch {
    return FALLBACK_SITE_URL;
  }
}
