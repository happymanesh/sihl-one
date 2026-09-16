/**
 * The Shah Investor's Home corporate logo.
 *
 * Replaces the drawn "SIHL ONE" mark and wordmark that stood here before —
 * change 7 asked for both the name and the icon to become the company logo.
 *
 * The supplied file is a JPEG with a solid white background, so it cannot sit
 * directly on the navy header without reading as a white rectangle someone
 * forgot to cut out. It is placed on a deliberate white plate instead, which
 * looks intentional on dark grounds and disappears on light ones. A transparent
 * PNG or, better, an SVG would remove the need for the plate entirely and would
 * stay sharp on high-density screens — worth asking marketing for.
 *
 * Rendered with a plain `img` rather than `next/image`: the file is 8 KB and a
 * fixed size, so optimisation buys nothing, and explicit dimensions prevent the
 * layout shift that would otherwise show on every page load.
 */

/** Natural size of the asset, used to keep the aspect ratio honest. */
const NATURAL_WIDTH = 249;
const NATURAL_HEIGHT = 96;
const RATIO = NATURAL_WIDTH / NATURAL_HEIGHT;

export function Logo({
  size = 'md',
  inverted = false,
}: {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** Set on dark grounds, where the plate needs an edge to sit against. */
  inverted?: boolean;
}) {
  // Taller than the old mark at every step: this logo carries the company name
  // inside the artwork, and below about thirty pixels the words stop being
  // words.
  //
  // Raised across the board on request — the mark was reading as small on the
  // sign-in panel and on the public capture page, which is the one screen a
  // prospect at a stall sees before deciding to hand over their number. `xl`
  // exists for those hero placements, where the logo is the only branding on
  // the page and has room to carry it.
  const height = { sm: 36, md: 46, lg: 64, xl: 84 }[size];
  const width = Math.round(height * RATIO);

  return (
    <span
      // `w-fit self-start` matters more than it looks: several callers place
      // this inside a flex column, where a child stretches to full width by
      // default — turning the plate into a 550-pixel white bar across the navy
      // panel. Hugging the artwork is the whole point of having a plate.
      // The dark-mode ring is a `dark:` variant rather than a prop, so callers
      // do not have to know the theme. `inverted` covers the panels that are
      // dark in *both* themes, such as the login hero.
      className={`inline-flex w-fit shrink-0 self-start items-center rounded-lg bg-white px-2 py-1.5 dark:ring-1 dark:ring-white/15 ${
        inverted ? 'ring-1 ring-white/25' : ''
      }`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/sihllogo.jpg"
        alt="Shah Investor's Home Ltd"
        width={width}
        height={height}
        style={{ height, width }}
        className="block"
      />
    </span>
  );
}
