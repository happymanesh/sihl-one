'use client';

/**
 * What the importer needs to prepare, stated before they choose a file.
 *
 * Without this the first step said only "save as CSV" and left people to guess
 * the columns. Auto-mapping covers a lot, but someone building a sheet from
 * scratch still has to know that a mobile number is mandatory and that
 * "12.5 lakh" is understood.
 */

const REQUIRED = [
  { field: 'Name', note: 'One column is fine — "Shah, Nirav" and "Nirav Shah" both work' },
  { field: 'Mobile', note: '+91 98765 43210, 09876543210 or 9876543210' },
];

const OPTIONAL = [
  { field: 'Email', note: 'Dropped if malformed; the row still imports' },
  { field: 'PAN', note: 'ABCDE1234F' },
  { field: 'City / State / PIN code', note: 'Used for routing rules' },
  { field: 'Product interest', note: '"Equity, F&O", "mutual funds/ipo", "PMS"' },
  { field: 'Estimated value', note: '12.5 lakh · 2cr · ₹5,00,000 · 1500000' },
  { field: 'Notes', note: 'Added to the lead as an opening note' },
];

/** Header row plus one filled example, so the format is unambiguous. */
const TEMPLATE = [
  'First Name,Last Name,Mobile No,Email ID,PAN,City,State,Product,Ticket Size,Remarks',
  'Nirav,Shah,9812345001,nirav.shah@example.com,ABCDE1234F,Ahmedabad,Gujarat,"Equity, F&O",12.5 lakh,Met at the Rajkot expo',
].join('\n');

export function ImportGuidance() {
  const downloadTemplate = () => {
    // A BOM so Excel opens the file as UTF-8 rather than mangling any accented
    // characters — and the parser strips it again on the way back in.
    // The leading U+FEFF is a deliberate UTF-8 BOM. Without it Excel opens the
    // template in the local codepage and mangles every non-ASCII name in it.
    // eslint-disable-next-line no-irregular-whitespace
    const blob = new Blob([`﻿${TEMPLATE}\n`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'sihl-one-lead-import-template.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-bold">What your file needs</h2>
          <p className="mt-0.5 text-sm text-[var(--color-text-muted)]">
            Column order does not matter — we match your headers and let you correct anything we
            get wrong.
          </p>
        </div>
        <button type="button" onClick={downloadTemplate} className="btn btn-outline">
          Download template
        </button>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">
            Required
          </h3>
          <ul className="mt-2 space-y-2">
            {REQUIRED.map((item) => (
              <li key={item.field}>
                <p className="text-sm font-semibold">
                  {item.field} <span className="text-danger-500">*</span>
                </p>
                <p className="text-xs text-[var(--color-text-subtle)]">{item.note}</p>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">
            Optional
          </h3>
          <ul className="mt-2 space-y-2">
            {OPTIONAL.map((item) => (
              <li key={item.field}>
                <p className="text-sm font-semibold">{item.field}</p>
                <p className="text-xs text-[var(--color-text-subtle)]">{item.note}</p>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <p className="mt-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-3 py-2 text-xs text-[var(--color-text-muted)]">
        Rows missing a name or a valid mobile number are reported and skipped — the rest of the
        file still imports. Nothing is created until you have reviewed every row.
      </p>
    </section>
  );
}
