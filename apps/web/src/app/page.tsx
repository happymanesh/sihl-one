import Link from 'next/link';
import { redirect } from 'next/navigation';

import { Logo } from '@/components/brand/Logo';
import { LeadCaptureForm } from '@/components/marketing/LeadCaptureForm';
import { getCurrentUser, homeRouteFor } from '@/lib/auth';

export const metadata = {
  title: 'Open a demat account with SIHL',
};

/**
 * The landing page is the front of the funnel described in the product vision:
 * marketing → lead capture → CRM. The form below posts to the public capture
 * endpoint, so a submission here becomes a scored, attributed lead sitting in
 * an RM's pipeline within the same request.
 */
export default async function LandingPage() {
  // Someone already signed in has no use for the marketing page.
  const user = await getCurrentUser();
  if (user) redirect(homeRouteFor(user));

  return (
    <div className="min-h-screen bg-[var(--color-canvas)]">
      <header className="sticky top-0 z-40 border-b border-[var(--color-border)] bg-[var(--color-surface)]/85 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3.5">
          <Logo />
          <nav className="flex items-center gap-2">
            <a href="#enquiry" className="btn btn-ghost hidden sm:inline-flex">
              Open an account
            </a>
            <Link href="/login" className="btn btn-primary">
              Staff &amp; partner sign in
            </Link>
          </nav>
        </div>
      </header>

      <main id="main">
        <section className="relative overflow-hidden">
          <div
            aria-hidden
            className="absolute inset-0 bg-gradient-to-br from-navy-600 via-navy-500 to-teal-700"
          />
          <div
            aria-hidden
            className="absolute inset-0 opacity-[0.07]"
            style={{
              backgroundImage:
                'radial-gradient(circle at 1px 1px, white 1px, transparent 0)',
              backgroundSize: '28px 28px',
            }}
          />

          <div className="relative mx-auto grid max-w-6xl gap-10 px-5 py-16 lg:grid-cols-[1.1fr_0.9fr] lg:py-24">
            <div className="text-white">
              <p className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider ring-1 ring-white/20">
                SEBI registered · Since 1994
              </p>
              <h1 className="mt-5 text-4xl font-extrabold leading-tight sm:text-5xl">
                Investing, brokerage and advice —{' '}
                <span className="text-brand-green-300">one relationship.</span>
              </h1>
              <p className="mt-5 max-w-xl text-lg text-white/85">
                Equity, derivatives, mutual funds, IPOs, PMS and NRI investing, backed by three
                decades of Shah Investors Home and a relationship manager who actually picks up
                the phone.
              </p>

              <dl className="mt-9 grid max-w-lg grid-cols-3 gap-4">
                {[
                  ['₹42,000 Cr+', 'Assets under management'],
                  ['30+ years', 'Serving Indian investors'],
                  ['12+', 'Investment products'],
                ].map(([value, label]) => (
                  <div key={label as string} className="rounded-lg bg-white/10 p-3 ring-1 ring-white/15">
                    <dt className="text-xl font-bold">{value}</dt>
                    <dd className="mt-0.5 text-xs text-white/75">{label}</dd>
                  </div>
                ))}
              </dl>
            </div>

            <div id="enquiry" className="scroll-mt-24">
              <div className="card overflow-hidden p-0">
                <div className="border-b border-[var(--color-border)] bg-[var(--color-surface-muted)] px-5 py-4">
                  <h2 className="text-lg font-bold">Open your account</h2>
                  <p className="mt-1 text-sm text-[var(--color-text-muted)]">
                    Tell us how to reach you. A relationship manager will call you back — usually
                    the same working day.
                  </p>
                </div>
                <div className="p-5">
                  <LeadCaptureForm />
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-5 py-16">
          <h2 className="text-2xl font-bold">One platform, every part of the journey</h2>
          <p className="mt-2 max-w-2xl text-[var(--color-text-muted)]">
            SIHL ONE connects marketing, sales, onboarding, servicing and partners. Nothing is
            re-keyed between systems, and nobody has to ask another department where a customer
            got to.
          </p>

          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[
              {
                title: 'Track your application',
                body: 'See exactly where your account opening has reached, from PAN check to first trade.',
              },
              {
                title: 'One relationship manager',
                body: 'A named RM with your full history — every call, meeting and document in one place.',
              },
              {
                title: 'All products, one login',
                body: 'Equity, F&O, commodities, mutual funds, IPOs, bonds, PMS and AIF.',
              },
              {
                title: 'Digital onboarding',
                body: 'PAN, Digilocker, bank verification and e-sign, without a branch visit.',
              },
              {
                title: 'Partner portal',
                body: 'Authorised persons and remisiers track leads, clients, revenue and payouts themselves.',
              },
              {
                title: 'Built for advice',
                body: 'Recommendations that reflect what you actually hold, not a generic product push.',
              },
            ].map((feature) => (
              <div key={feature.title} className="card p-5">
                <h3 className="font-bold">{feature.title}</h3>
                <p className="mt-1.5 text-sm text-[var(--color-text-muted)]">{feature.body}</p>
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer className="border-t border-[var(--color-border)] bg-[var(--color-surface)]">
        <div className="mx-auto max-w-6xl px-5 py-8">
          <Logo size="sm" />
          <p className="mt-4 max-w-4xl text-xs leading-relaxed text-[var(--color-text-subtle)]">
            Shah Investors Home Ltd. — SEBI Registration No. INZ000167335. Investments in
            securities are subject to market risks; read all related documents carefully before
            investing. Brokerage will not exceed the SEBI-prescribed limit. Past performance is
            not indicative of future returns.
          </p>
          <p className="mt-4 text-xs text-[var(--color-text-subtle)]">
            © {new Date().getFullYear()} Shah Investors Home Ltd. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}
