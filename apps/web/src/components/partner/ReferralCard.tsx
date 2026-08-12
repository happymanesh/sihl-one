import { CopyField } from '@/components/ui/CopyField';
import { QrCode } from '@/components/ui/QrCode';

export interface ReferralLink {
  code: string;
  url: string;
  partnerName: string;
  active: boolean;
}

/**
 * The partner's own onboarding link.
 *
 * Shown with both the URL and a QR because partners use them in different
 * places: the link goes into WhatsApp, the QR goes onto a visiting card or a
 * desk stand. The code itself is shown too — it gets read down a phone line,
 * which is why its alphabet excludes the characters people mishear.
 */
export function ReferralCard({ link }: { link: ReferralLink }) {
  return (
    <section className="card p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-[16rem] flex-1">
          <h2 className="font-bold">Refer a client</h2>
          <p className="mt-0.5 text-sm text-[var(--color-text-muted)]">
            Anyone who opens an account through this link is recorded as introduced by you, and
            that stays with the account when it is activated.
          </p>

          <div className="mt-4">
            <CopyField value={link.url} label="Your referral link" />
          </div>

          <p className="mt-3 text-xs text-[var(--color-text-muted)]">
            Referral code{' '}
            <span className="font-mono text-sm font-bold tracking-wider">{link.code}</span>
          </p>

          {!link.active ? (
            <p className="mt-3 rounded-lg border border-warn-500/40 bg-warn-50 px-3 py-2 text-xs text-warn-600 dark:bg-warn-500/15">
              Your account is not active, so this link is not accepting enquiries at the moment.
              Please speak to your SIHL contact.
            </p>
          ) : null}
        </div>

        <div className="text-center">
          <QrCode value={link.url} size={150} />
          <p className="mt-1.5 text-xs text-[var(--color-text-subtle)]">Scan to open an account</p>
        </div>
      </div>
    </section>
  );
}
