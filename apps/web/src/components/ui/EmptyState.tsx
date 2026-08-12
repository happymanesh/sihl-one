import type { ReactNode } from 'react';

/**
 * Empty states say what to do next, not just that there is nothing here.
 * "No leads found" leaves a user stuck; "No leads match these filters — clear
 * them or add a lead" does not.
 */
export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
      {icon ? <div className="text-[var(--color-text-subtle)]">{icon}</div> : null}
      <h3 className="text-base font-bold">{title}</h3>
      <p className="max-w-md text-sm text-[var(--color-text-muted)]">{description}</p>
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
