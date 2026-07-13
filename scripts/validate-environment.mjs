import { readFileSync } from 'node:fs';

const placeholders = /replace-me|replace-with|example\.com|user:password|your-/i;

function readEnvFile(path) {
  const values = {};
  for (const rawLine of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator < 1) continue;
    values[line.slice(0, separator)] = line.slice(separator + 1).trim().replace(/^['"]|['"]$/g, '');
  }
  return values;
}

export function validateEnvironment(values) {
  const errors = [];
  const environment = values.NODE_ENV;
  const publicEnvironment = environment === 'staging' || environment === 'production';

  if (!['development', 'staging', 'production'].includes(environment)) {
    errors.push('NODE_ENV must be development, staging, or production.');
  }

  for (const key of ['DATABASE_URL', 'JWT_SECRET', 'WEB_ORIGIN', 'VITE_API_BASE_URL']) {
    if (!values[key]) errors.push(`${key} is required.`);
  }

  if ((values.JWT_SECRET?.length ?? 0) < 32) {
    errors.push('JWT_SECRET must contain at least 32 characters.');
  }

  if (publicEnvironment) {
    for (const key of ['DATABASE_URL', 'JWT_SECRET', 'WEB_ORIGIN', 'VITE_API_BASE_URL']) {
      if (placeholders.test(values[key] ?? '')) errors.push(`${key} still contains a placeholder value.`);
    }
    if (values.ALLOW_DEMO_AUTH !== 'false') errors.push('ALLOW_DEMO_AUTH must be false outside development.');
    for (const key of ['WEB_ORIGIN', 'VITE_API_BASE_URL']) {
      const urls = (values[key] ?? '').split(',').map((value) => value.trim()).filter(Boolean);
      if (urls.some((url) => !url.startsWith('https://'))) errors.push(`${key} must use HTTPS outside development.`);
    }
  }

  return errors;
}

if (process.argv[1]?.endsWith('validate-environment.mjs')) {
  const fileIndex = process.argv.indexOf('--file');
  const values = fileIndex >= 0 ? readEnvFile(process.argv[fileIndex + 1]) : process.env;
  const errors = validateEnvironment(values);
  if (errors.length) {
    console.error(`Environment validation failed:\n- ${errors.join('\n- ')}`);
    process.exitCode = 1;
  } else {
    console.log(`Environment validation passed for ${values.NODE_ENV}.`);
  }
}
