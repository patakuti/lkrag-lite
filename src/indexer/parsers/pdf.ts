import fs from 'fs/promises';

// pdf-parse v1 exports a callable function; use require for CJS interop
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require('pdf-parse') as (buf: Buffer) => Promise<{ text: string }>;

export const extensions = ['.pdf'];

export async function parse(filePath: string): Promise<string> {
  const buf = await fs.readFile(filePath);
  const data = await pdfParse(buf);
  return data.text;
}
