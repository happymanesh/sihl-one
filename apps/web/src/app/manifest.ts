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
    /*
      Long-press the icon and go straight to capture.

      This is the whole point of the field-sales case: a rep with a client in
      front of them should not be navigating a menu. From a locked phone it is
      icon, shortcut, typing — no dashboard, no drawer, no scrolling.
    */
    shortcuts: [
      {
        name: 'Insta Lead',
        short_name: 'Insta Lead',
        description: 'Capture someone you are meeting right now',
        url: '/leads/insta',
      },
    ],
    icons: [
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
    ],
  };
}
