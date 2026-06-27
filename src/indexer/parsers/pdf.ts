import fs from 'fs/promises';

// pdf-parse v1 exports a callable function; use require for CJS interop
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require('pdf-parse') as (buf: Buffer) => Promise<{ text: string }>;

export const extensions = ['.pdf'];

const SUPPRESSED_WARNINGS = [
  'Unknown/unsupported post table version',
  'Ran out of space in font private use area',
];

function isSuppressed(args: unknown[]): boolean {
  const msg = String(args[0] ?? '');
  return SUPPRESSED_WARNINGS.some((w) => msg.includes(w));
}

export async function parse(filePath: string): Promise<string> {
  const buf = await fs.readFile(filePath);

  // pdf-parse's bundled pdf.js emits warnings via console.log("Warning: ...")
  // pdfjs-dist emits via console.warn("Warning: ..."); intercept both.
  const originalLog = console.log;
  const originalWarn = console.warn;
  console.log = (...args: unknown[]) => { if (!isSuppressed(args)) originalLog.apply(console, args); };
  console.warn = (...args: unknown[]) => { if (!isSuppressed(args)) originalWarn.apply(console, args); };

  try {
    const data = await pdfParse(buf);
    return data.text;
  } finally {
    console.log = originalLog;
    console.warn = originalWarn;
  }
}
