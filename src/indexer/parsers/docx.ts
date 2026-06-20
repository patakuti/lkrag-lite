import mammoth from 'mammoth';

export const extensions = ['.docx'];

export async function parse(filePath: string): Promise<string> {
  const result = await mammoth.extractRawText({ path: filePath });
  return result.value;
}
