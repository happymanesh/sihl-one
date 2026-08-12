/**
 * SIHL ONE wordmark, drawn rather than loaded as an image so it stays sharp at
 * any size, inherits the current colour, and costs no network request on the
 * login screen — which is the one page where first paint is most visible.
 */
export function Logo({
  size = 'md',
  inverted = false,
}: {
  size?: 'sm' | 'md' | 'lg';
  inverted?: boolean;
}) {
  const dimensions = { sm: 26, md: 32, lg: 44 }[size];
  const textSize = { sm: 'text-base', md: 'text-lg', lg: 'text-2xl' }[size];

  return (
    <span className="inline-flex items-center gap-2.5">
      <svg
        width={dimensions}
        height={dimensions}
        viewBox="0 0 40 40"
        fill="none"
        aria-hidden
        className="shrink-0"
      >
        <rect width="40" height="40" rx="10" fill="url(#sihl-brand)" />
        {/* An upward step chart — the business is investing, and the mark should
            say so without needing a caption. */}
        <path
          d="M10 27.5V22h4.5v5.5H10Zm7.75 0V17h4.5v10.5h-4.5Zm7.75 0V11.5H30V27.5h-4.5Z"
          fill="white"
          fillOpacity="0.95"
        />
        <defs>
          <linearGradient id="sihl-brand" x1="0" y1="0" x2="40" y2="40" gradientUnits="userSpaceOnUse">
            <stop stopColor="#0A5281" />
            <stop offset="0.55" stopColor="#1D8F6A" />
            <stop offset="1" stopColor="#66BB46" />
          </linearGradient>
        </defs>
      </svg>
      <span className={`font-extrabold tracking-tight ${textSize} ${inverted ? 'text-white' : ''}`}>
        SIHL{' '}
        <span className={inverted ? 'text-brand-green-300' : 'text-teal-600 dark:text-teal-300'}>
          ONE
        </span>
      </span>
    </span>
  );
}
