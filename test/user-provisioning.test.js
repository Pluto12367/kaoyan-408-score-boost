import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hashProvisionedPassword,
  validateProvisionedUserInput,
  verifyProvisionedPassword,
} from '../scripts/user-provisioning.mjs';

test('normalizes and validates teacher user input', () => {
  assert.deepEqual(validateProvisionedUserInput({
    email: '  Teacher@Example.COM ',
    password: 'ReliablePassword!408',
    name: ' 王老师 ',
  }), {
    email: 'teacher@example.com',
    password: 'ReliablePassword!408',
    name: '王老师',
  });
});

test('rejects invalid provisioned teacher credentials', () => {
  assert.throws(() => validateProvisionedUserInput({
    email: 'not-an-email',
    password: 'ReliablePassword!408',
    name: '王老师',
  }), /valid email/);

  assert.throws(() => validateProvisionedUserInput({
    email: 'teacher@example.com',
    password: 'short',
    name: '王老师',
  }), /8 to 128/);

  assert.throws(() => validateProvisionedUserInput({
    email: 'teacher@example.com',
    password: 'ReliablePassword!408',
    name: '',
  }), /Name is required/);
});

test('hashes provisioned passwords with the login-compatible scrypt format', async () => {
  const hash = await hashProvisionedPassword('ReliablePassword!408');

  assert.match(hash, /^scrypt\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/);
  assert.equal(await verifyProvisionedPassword('ReliablePassword!408', hash), true);
  assert.equal(await verifyProvisionedPassword('WrongPassword!408', hash), false);
});
