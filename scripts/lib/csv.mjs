/**
 * V14-P0 — CSV utilities shared by the real-exam scaffold generator and the
 * real-exam importer.
 *
 * parseCsv is the quote-aware parser already proven by
 * scripts/import-questions.mjs (starter-320 chain), copied here verbatim so
 * the validated chain stays untouched (design §7.1: no refactors of the
 * existing importer). stringifyCsv adds the writing side for the scaffold
 * generator: fields containing comma / quote / newline are quoted with `""`
 * escaping — the exact escaping rules the large-question template lessons
 * (current-sprint 2026-09-19) turned into hard requirements.
 */

export function parseCsv(text) {
  const lines = [];
  let current = [];
  let value = '';
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"' && inQuotes && next === '"') {
      value += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === ',' && !inQuotes) {
      current.push(value);
      value = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') index += 1;
      current.push(value);
      if (current.some((cell) => cell.length > 0)) lines.push(current);
      current = [];
      value = '';
      continue;
    }

    value += char;
  }

  current.push(value);
  if (current.some((cell) => cell.length > 0)) lines.push(current);

  if (inQuotes) {
    throw new Error('CSV ended while inside a quoted value.');
  }

  const [headers, ...body] = lines;
  if (!headers?.length) return [];

  return body.map((line) => Object.fromEntries(headers.map((header, index) => [header.trim(), line[index] ?? ''])));
}

export function stringifyCsv(rows, headers) {
  const escapeCell = (cell) => {
    const text = cell == null ? '' : String(cell);
    if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
    return text;
  };
  const lines = [headers.map(escapeCell).join(',')];
  for (const row of rows) {
    lines.push(headers.map((header) => escapeCell(row[header])).join(','));
  }
  return `${lines.join('\n')}\n`;
}
