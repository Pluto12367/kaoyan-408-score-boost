import test from 'node:test';
import assert from 'node:assert/strict';
import * as provisioning from '../scripts/user-provisioning.mjs';

const {
  hashProvisionedPassword,
  validateProvisionedUserInput,
  verifyProvisionedPassword,
} = provisioning;

function resolveProvisionedPasswordInput(input) {
  assert.equal(
    typeof provisioning.resolveProvisionedPasswordInput,
    'function',
    'user provisioning must expose a password-stdin resolver',
  );
  return provisioning.resolveProvisionedPasswordInput(input);
}

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

test('reads a provisioned password from one non-TTY stdin line', () => {
  assert.equal(resolveProvisionedPasswordInput({
    passwordStdin: true,
    stdinIsTTY: false,
    stdinText: 'ReliablePassword!408\n',
  }), 'ReliablePassword!408');
});

test('rejects password stdin when a TTY or a second line could expose ambiguous input', () => {
  assert.throws(() => resolveProvisionedPasswordInput({
    passwordStdin: true,
    stdinIsTTY: true,
    stdinText: '',
  }), /non-TTY stdin/);
  assert.throws(() => resolveProvisionedPasswordInput({
    passwordStdin: true,
    stdinIsTTY: false,
    stdinText: 'first\nsecond\n',
  }), /exactly one line/);
});

test('rejects selecting both a CLI password and password stdin', () => {
  assert.throws(() => resolveProvisionedPasswordInput({
    password: 'ReliablePassword!408',
    passwordStdin: true,
    stdinIsTTY: false,
    stdinText: 'OtherPassword!408\n',
  }), /either --password or --password-stdin/);
});
