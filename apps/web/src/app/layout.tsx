import type { Metadata, Viewport } from 'next';
import { Montserrat } from 'next/font/google';

import './globals.css';

const montserrat = Montserrat({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-montserrat',
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    default: 'SIHL LMS',
    template: '%s · SIHL LMS',
  },
  description:
    'The unified digital platform for Shah Investors Home Ltd. — marketing, CRM, onboarding, ' +
    'relationship management and partner journeys in one place.',
  applicationName: 'SIHL LMS',
  manifest: '/manifest.webmanifest',
  // The application is an internal system of engagement holding customer PII.
  // It must never appear in a search index.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#0a5281' },
    { media: '(prefers-color-scheme: dark)', color: '#04182b' },
  ],
  width: 'device-width',
  initialScale: 1,
  // Not locked to 1: field staff zoom into dense tables on small phones, and
  // blocking that is an accessibility failure as well as an annoyance.
  maximumScale: 5,
};

/**
 * Applies the saved theme before first paint.
 *
 * This has to be a blocking inline script. Doing it in an effect means the page
 * renders light, then flips to dark — the flash is worst on the login screen,
 * which is the first thing anyone sees.
 */
const themeScript = `
(function () {
  try {
    var stored = localStorage.getItem('sihl-theme');
    var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    var theme = stored || (prefersDark ? 'dark' : 'light');
    document.documentElement.setAttribute('data-theme', theme);
  } catch (e) {
    document.documentElement.setAttribute('data-theme', 'light');
  }
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN" suppressHydrationWarning className={montserrat.variable}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        {/* Keyboard users get to the content without tabbing the whole sidebar. */}
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-navy-500 focus:px-4 focus:py-2 focus:text-white"
        >
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
