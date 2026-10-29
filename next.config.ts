import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Let deployments that only defined SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY work
  // in the browser bundle too. Both values are public by design (the publishable key
  // is protected by row-level security), never put the service-role key here.
  env: {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '',
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || '',
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), geolocation=(), microphone=(self)' },
        ],
      },
    ]
  },
};

export default nextConfig;
