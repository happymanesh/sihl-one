/**
 * Inline icon set.
 *
 * Hand-rolled rather than pulled from an icon library: the app needs about a
 * dozen glyphs, and the smallest icon package still ships hundreds of KB of
 * components for tree-shaking to mostly — but not entirely — remove. On a
 * branch connection that is a real cost for no benefit.
 */
const PATHS: Record<string, string> = {
  grid: 'M4 4h6v6H4V4Zm10 0h6v6h-6V4ZM4 14h6v6H4v-6Zm10 0h6v6h-6v-6Z',
  target: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 4.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9Zm0 3a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3Z',
  columns: 'M4 4h4v16H4V4Zm6 0h4v16h-4V4Zm6 0h4v16h-4V4Z',
  users: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm7 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM3 20a6 6 0 0 1 12 0v1H3v-1Zm14-4.5a5.98 5.98 0 0 1 4 5.5v.5h-4v-6Z',
  check: 'M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2Z',
  pin: 'M12 2a7 7 0 0 0-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 0 0-7-7Zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5Z',
  megaphone: 'M3 10v4a1 1 0 0 0 1 1h2l5 4V5L6 9H4a1 1 0 0 0-1 1Zm13.5 2a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4Zm-2.5-8.5v2.1a6.5 6.5 0 0 1 0 12.8v2.1a8.5 8.5 0 0 0 0-17Z',
  handshake: 'M11 5 8 8l4 4 3-3 5 5-4 4-3-3-2 2-2-2-2 2-4-4 8-8Z',
  shield: 'M12 2 4 5v6c0 5 3.4 9.7 8 11 4.6-1.3 8-6 8-11V5l-8-3Zm0 5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5Zm0 6.5c1.9 0 4 .95 4 2.1V17H8v-1.4c0-1.15 2.1-2.1 4-2.1Z',
  file: 'M6 2h8l4 4v16H6V2Zm7 1.5V7h3.5L13 3.5ZM8 11h8v1.5H8V11Zm0 4h8v1.5H8V15Z',
  search: 'M10 4a6 6 0 1 0 3.6 10.8l4.3 4.3 1.4-1.4-4.3-4.3A6 6 0 0 0 10 4Zm0 2a4 4 0 1 1 0 8 4 4 0 0 1 0-8Z',
  plus: 'M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6V5Z',
  logout: 'M10 4v2H6v12h4v2H4V4h6Zm5.5 3.5L14 9l2 2H9v2h7l-2 2 1.5 1.5L20 12l-4.5-4.5Z',
  sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10Zm0-13V1m0 22v-3M4.2 4.2 2.1 2.1m19.8 19.8-2.1-2.1M4 12H1m22 0h-3M4.2 19.8l-2.1 2.1M21.9 2.1l-2.1 2.1',
  moon: 'M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z',
  bell: 'M12 22a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 12 22Zm7-5v-5a7 7 0 0 0-5.5-6.84V4a1.5 1.5 0 0 0-3 0v1.16A7 7 0 0 0 5 12v5l-2 2v1h18v-1l-2-2Z',
  menu: 'M3 6h18v2H3V6Zm0 5h18v2H3v-2Zm0 5h18v2H3v-2Z',
  chart: 'M4 20h16v2H2V2h2v18Zm3-3h3V9H7v8Zm5 0h3V5h-3v12Zm5 0h3v-5h-3v5Z',
};

export function Icon({
  name,
  size = 18,
  className,
}: {
  name: string;
  size?: number;
  className?: string;
}) {
  const path = PATHS[name] ?? PATHS.grid!;
  const isStroke = name === 'sun';

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={isStroke ? 'none' : 'currentColor'}
      stroke={isStroke ? 'currentColor' : undefined}
      strokeWidth={isStroke ? 2 : undefined}
      strokeLinecap={isStroke ? 'round' : undefined}
      className={className}
      aria-hidden
    >
      <path d={path} />
    </svg>
  );
}
