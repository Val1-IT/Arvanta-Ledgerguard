/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  transpilePackages: ['@ledgerguard/core'],
  eslint: {
    // Lint is run explicitly via `npm run lint` in CI; do not block builds on it.
    ignoreDuringBuilds: true
  }
};

export default nextConfig;
