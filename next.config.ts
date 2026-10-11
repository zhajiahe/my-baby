import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // Private media must be fetched by the browser with its family Cookie,
    // not anonymously by an optimizer/cache.
    unoptimized: true,
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.r2.dev',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https', 
        hostname: '*.r2.cloudflarestorage.com',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: '*.20250530.space',
        port: '',
        pathname: '/**',
      }
    ],
  },
  /* config options here */
};

export default nextConfig;
