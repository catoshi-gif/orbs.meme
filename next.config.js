/** @type {import('next').NextConfig} */
module.exports = {
  reactStrictMode: true,
  poweredByHeader: false,
  // The replay verifier loads Rapier's WASM/JS package in the Node runtime. Keep the package
  // external so Next does not rewrite/bundle its runtime asset assumptions.
  serverExternalPackages: ["@dimforge/rapier3d-compat"],
};
