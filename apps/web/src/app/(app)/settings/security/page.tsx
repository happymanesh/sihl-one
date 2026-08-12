import type { MfaSetupResponse, MfaStatus } from '@sihl-one/contracts';

import { MfaPanel } from '@/components/settings/MfaPanel';
import { QrCode } from '@/components/ui/QrCode';
import { apiFetch } from '@/lib/api';
import { requireUser } from '@/lib/auth';

export const metadata = { title: 'Security' };

export default async function SecurityPage() {
  const user = await requireUser();
  const status = await apiFetch<MfaStatus>('/auth/mfa');

  // The secret is minted per page load and stored nowhere until a code proves
  // it works, so a visit that goes no further leaves nothing behind.
  const setup = status.enabled
    ? null
    : await apiFetch<MfaSetupResponse>('/auth/mfa/setup', { method: 'POST', body: {} });

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <header>
        <h1 className="text-2xl font-bold">Security</h1>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          {user.email}
        </p>
      </header>

      <MfaPanel
        status={status}
        setup={setup}
        qr={setup ? <QrCode value={setup.otpauthUri} size={160} /> : null}
      />
    </div>
  );
}
