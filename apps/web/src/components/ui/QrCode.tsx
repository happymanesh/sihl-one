import QRCode from 'qrcode';

/**
 * A QR code, rendered server-side as inline SVG.
 *
 * SVG rather than a PNG data URI because these get printed — on a pull-up
 * banner, a table card, a partner's visiting card — and a raster QR that looked
 * fine on screen turns into soft edges at A3 that some phone cameras will not
 * lock onto.
 *
 * `errorCorrectionLevel: 'M'` recovers about 15% of the symbol, which is what
 * makes a code still scan with a thumbprint on it or a crease through a corner.
 */
export async function QrCode({
  value,
  size = 180,
  className,
}: {
  value: string;
  size?: number;
  className?: string;
}) {
  const svg = await QRCode.toString(value, {
    type: 'svg',
    errorCorrectionLevel: 'M',
    margin: 1,
    width: size,
    color: { dark: '#0A5281', light: '#FFFFFF' },
  });

  return (
    <div
      className={`inline-block rounded-lg bg-white p-2 ${className ?? ''}`}
      // The SVG comes from the QR encoder, not from user input — the value is
      // encoded into path data, never interpolated into markup.
      dangerouslySetInnerHTML={{ __html: svg }}
      role="img"
      aria-label={`QR code for ${value}`}
    />
  );
}
