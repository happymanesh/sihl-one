import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center px-5">
      <div className="card max-w-md p-6 text-center">
        <p className="text-4xl font-extrabold text-navy-500">404</p>
        <h1 className="mt-2 text-xl font-bold">Page not found</h1>
        <p className="mt-2 text-sm text-[var(--color-text-muted)]">
          This page does not exist, or the record you were looking for is outside your data scope.
        </p>
        <Link href="/dashboard" className="btn btn-primary mt-5">
          Back to dashboard
        </Link>
      </div>
    </div>
  );
}
