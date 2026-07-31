import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);

export function validateProvisionedUserInput(input) {
  const email = normalizeEmail(input.email);
  const password = validatePassword(input.password);
  const name = input.name?.trim();
  if (!name || name.length > 40) {
    throw new Error('Name is required and must not exceed 40 characters.');
  }
  return { email, password, name };
}

export async function hashProvisionedPassword(password) {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString('base64url')}$${derived.toString('base64url')}`;
}

export async function verifyProvisionedPassword(password, stored) {
  const [algorithm, saltValue, hashValue] = stored.split('$');
  if (algorithm !== 'scrypt' || !saltValue || !hashValue) return false;
  const expected = Buffer.from(hashValue, 'base64url');
  const actual = await scrypt(password, Buffer.from(saltValue, 'base64url'), expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function resolveProvisionedPasswordInput({
  password,
  passwordStdin = false,
  stdinIsTTY = false,
  stdinText,
  readStdin,
}) {
  if (password && passwordStdin) {
    throw new Error('Use either --password or --password-stdin, not both.');
  }
  if (!passwordStdin) return password;
  if (stdinIsTTY) {
    throw new Error('--password-stdin requires non-TTY stdin; pipe exactly one password line.');
  }

  const input = stdinText ?? readStdin?.();
  if (typeof input !== 'string') {
    throw new Error('--password-stdin did not receive a password line.');
  }
  const value = input.replace(/\r?\n$/, '');
  if (/[\r\n]/.test(value)) {
    throw new Error('--password-stdin accepts exactly one line.');
  }
  return value;
}

function normalizeEmail(value) {
  const email = value?.trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    throw new Error('A valid email is required.');
  }
  return email;
}

function validatePassword(value) {
  if (!value || value.length < 8 || value.length > 128) {
    throw new Error('Password must contain 8 to 128 characters.');
  }
  return value;
}
