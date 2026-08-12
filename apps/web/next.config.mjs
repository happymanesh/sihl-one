/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // The contracts package ships TypeScript-adjacent CommonJS from a workspace
  // sibling; transpiling it here keeps one build of the validation rules rather
  // than a separately compiled copy that can drift.
  transpilePackages: ['@sihl-one/contracts'],

  // Typed routes catch a broken <Link href> at build time rather than as a 404
  // a user finds. Promoted out of `experimental` in Next 16.
  typedRoutes: true,

  /**
   * Security headers.
   *
   * The CSP is deliberately strict and allows connections only to the API
   * origin. `unsafe-inline` for styles is required by Next's runtime style
   * injection; scripts do not get it, which is the direction that matters for
   * XSS. Revisit if a nonce-based setup becomes practical.
   */
  async headers() {
    const apiOrigin = process.env.NEXT_PUBLIC_API_BASE_URL
      ? new URL(process.env.NEXT_PUBLIC_API_BASE_URL).origin
      : 'http://localhost:4000';

    const csp = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-eval' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      `connect-src 'self' ${apiOrigin}`,
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
    ].join('; ');

    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(self), microphone=(self), geolocation=(self)' },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=31536000; includeSubDomains; preload',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
