import path from "node:path";
import type { NextConfig } from "next";

const root = path.resolve(import.meta.dirname);

const nextConfig: NextConfig = {
  poweredByHeader: false,
  agentRules: false,
  reactStrictMode: true,
  outputFileTracingRoot: root,
  turbopack: { root },
  // Server-only libraries that rely on Node APIs, WASM or native file access are
  // loaded from node_modules at runtime rather than bundled.
  serverExternalPackages: [
    "@electric-sql/pglite",
    "pg",
    "unpdf",
    "mammoth",
    "docxtemplater",
    "pizzip",
    "pdf-lib",
    "docx",
    "@azure/msal-node",
    "@azure/storage-blob",
    "@azure/identity",
    "@anthropic-ai/sdk",
  ],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
        ],
      },
    ];
  },
  experimental: {
    // Uploads go through route handlers (not server actions); keep server actions small.
    serverActions: { bodySizeLimit: "1mb" },
  },
};

export default nextConfig;
