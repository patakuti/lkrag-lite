import fs from 'fs/promises';

// pdf-parse types don't expose a callable default in Node16 module resolution
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require('pdf-parse') as (buf: Buffer) => Promise<{ text: string }>;

export const extensions = ['.pdf'];

export async function parse(filePath: string): Promise<string> {
  const buf = await fs.readFile(filePath);
  const data = await pdfParse(buf);
  return data.text;
}
