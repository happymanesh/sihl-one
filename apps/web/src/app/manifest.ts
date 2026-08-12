import type { MetadataRoute } from 'next';

/**
 * PWA manifest.
 *
 * `display: standalone` matters for the field-sales use case: an RM adding SIHL
 * ONE to their home screen gets a full-height viewport with no browser chrome,
 * which is the difference between the visit check-in flow fitting on one screen
 * and not.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'SIHL ONE',
    short_name: 'SIHL ONE',
    description: 'The unified digital platform for Shah Investors Home Ltd.',
    start_url: '/dashboard',
    display: 'standalone',
    orientation: 'portrait-primary',
    background_color: '#f5f9fc',
    theme_color: '#0a5281',
    categories: ['business', 'finance', 'productivity'],
    icons: [
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
    ],
  };
}
