import type { Metadata } from 'next';
import { BROCHURES } from '@sihl-one/contracts';

import { Logo } from '@/components/brand/Logo';

export const metadata: Metadata = {
  /*
    Absolute, so the layout's "· SIHL LMS" suffix is not appended. This page is
    sent to prospective clients by SMS; the internal product name has no
    business in their browser tab.
  */
  title: { absolute: 'Shah Investors Home Ltd — brochures' },
  description: 'Our products, wealth management, global investing and partner programme.',
};

const SUPPORT_PHONE = process.env.NEXT_PUBLIC_SUPPORT_PHONE ?? '079-6508-1699';
const SUPPORT_EMAIL = process.env.NEXT_PUBLIC_SUPPORT_EMAIL ?? 'helpdesk@sihl.in';

/**
 * The page the SMS link opens.
 *
 * Public, unauthenticated, and deliberately common to every event: one short
 * link works on every banner and in every message, and a brochure can be
 * replaced without reissuing anything.
 *
 * It reads from the same catalogue the confirmation email does, so a title
 * cannot say one thing here and another in somebody's inbox.
 *
 * Read on a phone, at a stall, on hall wifi. That shapes everything below:
 * nothing to load before the list is useful, and each file's size stated up
 * front, because a visitor on a metered connection deserves to know a brochure
 * is 27MB before they tap it. The one image is the logo — 8KB, with its
 * dimensions declared, so it costs nothing and shifts nothing.
 */
export default function BrochuresPage() {
  return (
    <main className="mx-auto w-full max-w-2xl px-5 py-10">
      {/*
        The logo, centred, above everything.

        This page arrives by SMS link on a stranger's phone, with no header and no
        navigation around it — it is the only thing on the screen that says who
        sent them here. Centred and at `lg` it reads as a masthead rather than as
        a corner mark. `justify-center` on the wrapper rather than a text-align,
        because the component hugs its artwork with `w-fit self-start`; `self-start`
        only governs the cross axis, so it does not fight the centring.
      */}
      <div className="flex justify-center">
        <Logo size="lg" />
      </div>

      <header className="mt-6">
        <p className="text-xs font-bold uppercase tracking-[0.12em] text-teal-700 dark:text-teal-300">
          Shah Investors Home Ltd
        </p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">A closer look at our solutions</h1>
        <p className="mt-2 text-[var(--color-text-muted)]">
          Thank you for visiting us. Everything below is yours to read at your own pace.
        </p>
      </header>

      <ul className="mt-8 flex flex-col gap-3">
        {BROCHURES.map((brochure) => (
          <li key={brochure.file}>
            <a
              href={`/brochures/${brochure.file}`}
              target="_blank"
              rel="noopener"
              className="card flex items-baseline justify-between gap-4 p-4 transition-colors hover:border-teal-500"
            >
              <span className="min-w-0">
                <span className="block font-bold">{brochure.title}</span>
                <span className="mt-0.5 block text-sm text-[var(--color-text-muted)]">
                  {brochure.description}
                </span>
              </span>
              <span className="shrink-0 text-xs font-semibold text-teal-700 dark:text-teal-300">
                PDF
              </span>
            </a>
          </li>
        ))}
      </ul>

      <section className="mt-10 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-4 py-4">
        <h2 className="font-bold">Talk to us</h2>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          Call{' '}
          <a
            href={`tel:${SUPPORT_PHONE.replace(/[^0-9+]/g, '')}`}
            className="font-semibold underline underline-offset-2"
          >
            {SUPPORT_PHONE}
          </a>{' '}
          or write to{' '}
          <a
            href={`mailto:${SUPPORT_EMAIL}`}
            className="font-semibold underline underline-offset-2"
          >
            {SUPPORT_EMAIL}
          </a>
          .
        </p>
      </section>

      <footer className="mt-8 text-xs text-[var(--color-text-subtle)]">
        {/*
          Not a disclaimer by choice — a SEBI-registered broker linking product
          literature has to carry one, and a page that exists to be sent to
          prospective clients is exactly where it belongs.
        */}
        Investments in securities markets are subject to market risks. Read all the related
        documents carefully before investing.
      </footer>
    </main>
  );
}
