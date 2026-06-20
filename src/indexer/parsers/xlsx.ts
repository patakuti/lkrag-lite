import * as XLSX from 'xlsx';

export const extensions = ['.xlsx'];

export async function parse(filePath: string): Promise<string> {
  const wb = XLSX.readFile(filePath);
  const parts: string[] = [];
  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    const csv = XLSX.utils.sheet_to_csv(ws, { blankrows: false });
    if (csv.trim()) {
      parts.push(`## ${sheetName}\n${csv}`);
    }
  }
  return parts.join('\n\n');
}
