import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaClient, Difficulty, QuestionType, Subject } from '@prisma/client';
import { computeContentFingerprint } from '@kaoyan408/shared';

const DEFAULT_FILE = 'kaoyan-408-content-starter/imports/starter-40-questions.csv';

const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const replace = args.has('--replace');
const fileArg = process.argv.slice(2).find((arg) => !arg.startsWith('--'));
const filePath = resolve(process.cwd(), fileArg ?? DEFAULT_FILE);

const knowledgePointSeed = new Map([
  ['ds-tree', {
    subject: Subject.DATA_STRUCTURE,
    chapter: '树与二叉树',
    title: '树的遍历应用',
    importance: 5,
    frequency: 5,
    prerequisites: ['线性表'],
  }],
  ['co-cache', {
    subject: Subject.COMPUTER_ORGANIZATION,
    chapter: '存储系统',
    title: 'Cache 映射与替换',
    importance: 5,
    frequency: 5,
    prerequisites: ['存储层次'],
  }],
  ['os-sync', {
    subject: Subject.OPERATING_SYSTEM,
    chapter: '进程管理',
    title: '进程同步与互斥',
    importance: 5,
    frequency: 5,
    prerequisites: ['进程状态'],
  }],
  ['net-tcp', {
    subject: Subject.COMPUTER_NETWORK,
    chapter: '传输层',
    title: 'TCP 可靠传输',
    importance: 4,
    frequency: 5,
    prerequisites: ['滑动窗口'],
  }],
]);

const difficultyMap = new Map([
  ['基础', Difficulty.BASIC],
  ['中等', Difficulty.MEDIUM],
  ['困难', Difficulty.HARD],
]);

const typeMap = new Map([
  ['选择题', QuestionType.SINGLE_CHOICE],
  ['综合题', QuestionType.COMPREHENSIVE],
  ['判断题', QuestionType.JUDGEMENT],
]);

const rows = parseCsv(readFileSync(filePath, 'utf8'));
const questions = validateRows(rows);

console.log(`Question import file: ${filePath}`);
console.log(`Validated ${questions.length} questions.`);

if (dryRun) {
  const byPoint = countBy(questions.flatMap((question) => question.knowledgePointIds));
  console.log('Dry run only. Knowledge point distribution:', byPoint);
  process.exit(0);
}

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required unless --dry-run is used.');
}

const prisma = new PrismaClient();

try {
  let created = 0;
  let updated = 0;
  let skipped = 0;

  await prisma.$transaction(async (tx) => {
    for (const [id, point] of knowledgePointSeed) {
      await tx.knowledgePoint.upsert({
        where: { id },
        create: { id, ...point },
        update: point,
      });
    }

    for (const question of questions) {
      const existing = await tx.question.findFirst({
        where: {
          isCurrent: true,
          stem: question.stem,
          source: question.source,
          year: question.year,
        },
        include: { knowledgePoints: true },
      });

      if (existing && !replace) {
        skipped += 1;
        continue;
      }

      if (existing) {
        await tx.question.update({
          where: { id: existing.id },
          data: { isCurrent: false },
        });
        await tx.question.create({
          data: {
            ...toQuestionWrite(question),
            familyId: existing.familyId,
            versionNumber: existing.versionNumber + 1,
            isCurrent: true,
            contentFingerprint: computeContentFingerprint(question),
            knowledgePoints: {
              create: question.knowledgePointIds.map((knowledgePointId) => ({ knowledgePointId })),
            },
          },
        });
        updated += 1;
        continue;
      }

      await tx.question.create({
        data: {
          ...toQuestionWrite(question),
          family: { create: {} },
          versionNumber: 1,
          isCurrent: true,
          contentFingerprint: computeContentFingerprint(question),
          knowledgePoints: {
            create: question.knowledgePointIds.map((knowledgePointId) => ({ knowledgePointId })),
          },
        },
      });
      created += 1;
    }
  });

  console.log(`Import complete. created=${created} updated=${updated} skipped=${skipped}`);
} finally {
  await prisma.$disconnect();
}

function toQuestionWrite(question) {
  return {
    stem: question.stem,
    options: question.options,
    answer: question.answer,
    analysis: question.analysis,
    difficulty: question.difficulty,
    type: question.type,
    source: question.source,
    year: question.year,
    expectedTimeSec: question.expectedTimeSec,
  };
}

function validateRows(inputRows) {
  if (inputRows.length === 0) {
    throw new Error('CSV contains no question rows.');
  }

  return inputRows.map((row, index) => {
    const line = index + 2;
    const required = ['stem', 'options', 'answer', 'analysis', 'knowledgePointIds', 'difficulty', 'type', 'source'];
    for (const field of required) {
      if (!row[field]?.trim()) {
        throw new Error(`Line ${line}: missing required field "${field}".`);
      }
    }

    const options = row.options.split('|').map((option) => option.trim()).filter(Boolean);
    if (options.length < 2) {
      throw new Error(`Line ${line}: options must contain at least two entries separated by "|".`);
    }

    const knowledgePointIds = row.knowledgePointIds.split('|').map((id) => id.trim()).filter(Boolean);
    if (knowledgePointIds.length === 0) {
      throw new Error(`Line ${line}: at least one knowledge point is required.`);
    }
    for (const id of knowledgePointIds) {
      if (!knowledgePointSeed.has(id)) {
        throw new Error(`Line ${line}: unknown knowledge point "${id}". Add it to knowledgePointSeed first.`);
      }
    }

    const difficulty = difficultyMap.get(row.difficulty.trim());
    if (!difficulty) {
      throw new Error(`Line ${line}: unsupported difficulty "${row.difficulty}".`);
    }

    const type = typeMap.get(row.type.trim());
    if (!type) {
      throw new Error(`Line ${line}: unsupported question type "${row.type}".`);
    }

    const year = row.year?.trim() ? Number(row.year) : null;
    if (year !== null && (!Number.isInteger(year) || year < 2000 || year > 2100)) {
      throw new Error(`Line ${line}: year must be a valid integer.`);
    }

    const expectedTimeSec = row.expectedTimeSec?.trim() ? Number(row.expectedTimeSec) : 100;
    if (!Number.isInteger(expectedTimeSec) || expectedTimeSec < 30) {
      throw new Error(`Line ${line}: expectedTimeSec must be an integer >= 30.`);
    }

    return {
      stem: row.stem.trim(),
      options,
      answer: row.answer.trim(),
      analysis: row.analysis.trim(),
      knowledgePointIds,
      difficulty,
      type,
      source: row.source.trim(),
      year,
      expectedTimeSec,
    };
  });
}

function parseCsv(text) {
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

function countBy(values) {
  return values.reduce((acc, value) => {
    acc[value] = (acc[value] ?? 0) + 1;
    return acc;
  }, {});
}
