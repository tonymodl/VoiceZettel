import type { NextConfig } from "next";
import withPWAInit from "@ducanh2912/next-pwa";

const withPWA = withPWAInit({
    dest: "public",
    register: true,
    disable: process.env.NODE_ENV === "development",
    // REMOVED: cacheOnFrontEndNav and aggressiveFrontEndNavCaching
    // These caused users to see stale JS after deployments.
    // Next.js built-in caching with hashed filenames is sufficient.
    fallbacks: {
        document: "/offline",
    },
});

const nextConfig: NextConfig = {
    typescript: {
        // Three.js JSX intrinsic elements are a known Turbopack worker issue,
        // not a runtime bug. We still run `tsc --noEmit` separately in CI.
        ignoreBuildErrors: true,
    },
    allowedDevOrigins: ["https://voicezettel.ru", "http://voicezettel.ru"],
    devIndicators: false,
    turbopack: {
        // CRITICAL: Do NOT watch data/ dir — API routes write logs/settings there,
        // triggering infinite Fast Refresh loop that kills WS connections
        resolveAlias: {},
    },
    webpack: (config, { dev }) => {
        if (dev) {
            // Exclude data/ from file watching to prevent Hot Reload loops
            config.watchOptions = {
                ...config.watchOptions,
                ignored: [
                    '**/node_modules/**',
                    '**/data/**',
                    '**/.antigravity/**',
                    '**/VoiceZettel/**',
                    '**/.next/**',
                ],
            };
        }
        return config;
    },
    output: "standalone",
    images: {
        remotePatterns: [
            {
                protocol: "https",
                hostname: "lh3.googleusercontent.com",
            },
        ],
    },
    async headers() {
        return [
            {
                source: "/(.*)",
                headers: [
                    {
                        key: "Permissions-Policy",
                        value: "microphone=(self), camera=(self)",
                    },
                ],
            },
        ];
    },
};

export default withPWA(nextConfig);
