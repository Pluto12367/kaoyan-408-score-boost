import { PrismaClient, TrialStatus, UserRole } from '@prisma/client';
import { readFileSync } from 'node:fs';
import {
  hashProvisionedPassword,
  resolveProvisionedPasswordInput,
  validateProvisionedUserInput,
} from './user-provisioning.mjs';

const flags = parseFlags(process.argv.slice(2));
const role = flags.role ?? 'teacher';

if (!['teacher', 'admin'].includes(role)) {
  throw new Error('--role must be either "teacher" or "admin".');
}

const input = validateProvisionedUserInput({
  email: flags.email,
  password: resolveProvisionedPasswordInput({
    password: flags.password,
    passwordStdin: flags['password-stdin'] === true,
    stdinIsTTY: process.stdin.isTTY,
    readStdin: () => readFileSync(0, 'utf8'),
  }),
  name: flags.name ?? (role === 'admin' ? '管理员' : '教研老师'),
});

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required to create a user.');
}

const prisma = new PrismaClient();

try {
  const passwordHash = await hashProvisionedPassword(input.password);
  const userRole = role === 'admin' ? UserRole.ADMIN : UserRole.TEACHER;
  const user = await prisma.user.upsert({
    where: { email: input.email },
    create: {
      email: input.email,
      passwordHash,
      name: input.name,
      role: userRole,
      trialStatus: TrialStatus.ACTIVE,
    },
    update: {
      passwordHash,
      name: input.name,
      role: userRole,
      trialStatus: TrialStatus.ACTIVE,
    },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      trialStatus: true,
    },
  });

  console.log(`Provisioned ${role} account: ${user.email}`);
  console.log(`id=${user.id} role=${user.role} trialStatus=${user.trialStatus}`);
} finally {
  await prisma.$disconnect();
}

function parseFlags(args) {
  const values = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith('--')) continue;
    const [rawKey, inlineValue] = arg.slice(2).split('=', 2);
    if (rawKey === 'password-stdin' && inlineValue == null) {
      values[rawKey] = true;
      continue;
    }
    values[rawKey] = inlineValue ?? args[index + 1];
    if (inlineValue == null) index += 1;
  }
  return values;
}
