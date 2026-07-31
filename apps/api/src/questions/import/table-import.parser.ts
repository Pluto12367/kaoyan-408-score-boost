import * as ExcelJS from 'exceljs';
import type { ImportWarning } from '@kaoyan408/shared';

export const QUESTION_IMPORT_SHEET = '题库导入';
export const QUESTION_IMPORT_HEADERS = [
  '科目', '章节', '知识点', '题型', '难度', '题干', '选项 A', '选项 B',
  '选项 C', '选项 D', '正确答案', '答案解析', '来源', '年份', '建议答题时间（秒）',
] as const;

const MAX_DATA_ROWS = 1000;

export interface TableParseResult {
  rows: Array<{ rowNumber: number; values: Record<string, unknown> }>;
  issues: ImportWarning[];
}

function issue(code: string, message: string, suggestion: string): ImportWarning {
  return { code, severity: 'error', message, suggestion };
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          value += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        value += character;
      }
      continue;
    }
    if (character === '"' && value.length === 0) {
      quoted = true;
    } else if (character === ',') {
      row.push(value);
      value = '';
    } else if (character === '\n') {
      row.push(value);
      rows.push(row);
      row = [];
      value = '';
    } else if (character !== '\r') {
      value += character;
    }
  }
  if (quoted) throw new Error('CSV_UNTERMINATED_QUOTE');
  if (value.length > 0 || row.length > 0) {
    row.push(value);
    rows.push(row);
  }
  return rows;
}

function hasValue(value: unknown): boolean {
  return value !== undefined && value !== null && String(value).trim() !== '';
}

function safeCellValue(value: ExcelJS.CellValue): { value?: unknown; formulaUnavailable?: boolean } {
  if (value && typeof value === 'object' && 'formula' in value) {
    return 'result' in value && value.result !== undefined && value.result !== null
      ? { value: value.result }
      : { formulaUnavailable: true };
  }
  if (value && typeof value === 'object' && 'richText' in value) {
    return { value: value.richText.map((part) => part.text).join('') };
  }
  if (value && typeof value === 'object' && 'text' in value) return { value: value.text };
  return { value };
}

export class TableImportParser {
  async parse(buffer: Buffer, fileName: string): Promise<TableParseResult> {
    const extension = fileName.slice(fileName.lastIndexOf('.')).toLowerCase();
    if (extension === '.xls' || (extension !== '.xlsx' && extension !== '.csv')) {
      return { rows: [], issues: [issue('UNSUPPORTED_FILE_TYPE', '只支持 .xlsx 和 .csv 文件。', '请导出为 .xlsx 或 UTF-8 CSV 后重试。')] };
    }
    if (extension === '.csv') return this.parseCsv(buffer);
    return this.parseXlsx(buffer);
  }

  private async parseXlsx(buffer: Buffer): Promise<TableParseResult> {
    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    } catch {
      return { rows: [], issues: [issue('INVALID_XLSX', 'XLSX 文件无法读取。', '请重新导出文件后重试。')] };
    }
    const worksheet = workbook.getWorksheet(QUESTION_IMPORT_SHEET);
    if (!worksheet) {
      return { rows: [], issues: [issue('MISSING_IMPORT_SHEET', `未找到“${QUESTION_IMPORT_SHEET}”工作表。`, '请使用下载的标准模板。')] };
    }
    if (worksheet.rowCount - 1 > MAX_DATA_ROWS) {
      return { rows: [], issues: [issue('ROW_LIMIT_EXCEEDED', '单次最多导入 1000 行题目。', '请拆分为多个文件后重试。')] };
    }
    const headers = Array.from(
      { length: worksheet.columnCount },
      (_, index) => worksheet.getRow(1).getCell(index + 1).text.trim(),
    );
    return this.rowsFromCells(
      Array.from({ length: Math.max(0, worksheet.rowCount - 1) }, (_, index) => {
        const worksheetRow = worksheet.getRow(index + 2);
        const cells = Array.from(
          { length: worksheet.columnCount },
          (_, cellIndex) => worksheetRow.getCell(cellIndex + 1).value as ExcelJS.CellValue,
        );
        return { rowNumber: index + 2, cells, headers };
      }),
    );
  }

  private parseCsv(buffer: Buffer): TableParseResult {
    let records: string[][];
    try {
      records = parseCsv(buffer.toString('utf8').replace(/^\uFEFF/u, ''));
    } catch {
      return { rows: [], issues: [issue('INVALID_CSV', 'CSV 引号格式不正确。', '请使用 UTF-8 CSV，并检查成对的双引号。')] };
    }
    const [headers = [], ...dataRows] = records;
    const nonEmptyRows = dataRows.filter((cells) => cells.some(hasValue));
    if (nonEmptyRows.length > MAX_DATA_ROWS) {
      return { rows: [], issues: [issue('ROW_LIMIT_EXCEEDED', '单次最多导入 1000 行题目。', '请拆分为多个文件后重试。')] };
    }
    return this.rowsFromCells(dataRows.map((cells, index) => ({ rowNumber: index + 2, cells, headers })));
  }

  private rowsFromCells(input: Array<{ rowNumber: number; cells: ExcelJS.CellValue[]; headers: string[] }>): TableParseResult {
    const rows: TableParseResult['rows'] = [];
    const issues: ImportWarning[] = [];
    for (const { rowNumber, cells, headers } of input) {
      if (!cells.some(hasValue)) continue;
      const values: Record<string, unknown> = {};
      let hasUnavailableFormula = false;
      cells.forEach((cell, index) => {
        const header = headers[index];
        if (!header) return;
        const parsed = safeCellValue(cell);
        if (parsed.formulaUnavailable) hasUnavailableFormula = true;
        else values[header] = parsed.value;
      });
      if (hasUnavailableFormula) {
        issues.push(issue('FORMULA_VALUE_UNAVAILABLE', `第 ${rowNumber} 行含有未缓存结果的公式。`, '请粘贴公式计算后的值，而不是公式。'));
        continue;
      }
      rows.push({ rowNumber, values });
    }
    return { rows, issues };
  }
}
