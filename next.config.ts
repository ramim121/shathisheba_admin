import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Next 16 refuses its dev assets to any host but localhost, so opening the
  // console on the LAN IP (to test from a phone or another PC) rendered the
  // login page with none of its JavaScript — the Sign in button did nothing.
  // Development only; production is unaffected.
  allowedDevOrigins: ["192.168.*.*", "10.*.*.*", "172.*.*.*"]
};

export default nextConfig;
