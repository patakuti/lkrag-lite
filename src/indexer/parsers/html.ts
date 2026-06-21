import * as cheerio from 'cheerio';
import fs from 'fs/promises';

export const extensions = ['.html', '.htm'];

export async function parse(filePath: string): Promise<string> {
  const raw = await fs.readFile(filePath, 'utf-8');
  const $ = cheerio.load(raw);
  $('script, style, noscript').remove();
  return $('body').text().replace(/\s+/g, ' ').trim();
}
