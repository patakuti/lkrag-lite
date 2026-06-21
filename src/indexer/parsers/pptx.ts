import { parseOffice, OfficeParserAST } from 'officeparser';

export const extensions = ['.pptx'];

export async function parse(filePath: string): Promise<string> {
  const result = await (parseOffice(filePath, {}) as unknown as Promise<OfficeParserAST>);
  return result.toText();
}
