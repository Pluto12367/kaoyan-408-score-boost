import * as ExcelJS from 'exceljs';
import { QUESTION_IMPORT_HEADERS, QUESTION_IMPORT_SHEET } from './table-import.parser';

const SUBJECTS = ['数据结构', '计算机组成原理', '操作系统', '计算机网络'];
const TYPES = ['选择题', '综合题', '判断题'];
const DIFFICULTIES = ['基础', '中等', '困难'];
const ANSWERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

function validation(values: string[]) {
  return { type: 'list' as const, allowBlank: true, formulae: [`"${values.join(',')}"`] };
}

export class QuestionTemplateService {
  async buildXlsx(): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet(QUESTION_IMPORT_SHEET);
    sheet.addRow(QUESTION_IMPORT_HEADERS);
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    sheet.getRow(1).font = { bold: true };
    sheet.columns = QUESTION_IMPORT_HEADERS.map((header) => ({ header, width: Math.max(14, header.length + 4) }));
    for (let row = 2; row <= 1001; row += 1) {
      sheet.getCell(`A${row}`).dataValidation = validation(SUBJECTS);
      sheet.getCell(`D${row}`).dataValidation = validation(TYPES);
      sheet.getCell(`E${row}`).dataValidation = validation(DIFFICULTIES);
      sheet.getCell(`K${row}`).dataValidation = validation(ANSWERS);
    }

    const instructions = workbook.addWorksheet('填写说明');
    instructions.columns = [{ width: 24 }, { width: 80 }];
    instructions.addRows([
      ['字段', '说明'],
      ['题干', '必填。请填写题目正文，不要输入 Excel 公式。'],
      ['选择题', '填写 2 至 8 个选项；正确答案填写对应的 A 至 H。'],
      ['来源', '必填。仅导入有权使用的资料。'],
      ['CSV', '请使用 UTF-8 编码；含逗号或换行的字段须用双引号包裹。'],
    ]);
    instructions.getRow(1).font = { bold: true };
    return Buffer.from(await workbook.xlsx.writeBuffer());
  }

  buildCsv(): Buffer {
    return Buffer.from(`\uFEFF${QUESTION_IMPORT_HEADERS.join(',')}\r\n`, 'utf8');
  }
}
