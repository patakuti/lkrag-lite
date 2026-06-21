import fs from 'fs/promises';

export const extensions = ['.md', '.txt'];

export async function parse(filePath: string): Promise<string> {
  return fs.readFile(filePath, 'utf-8');
}
