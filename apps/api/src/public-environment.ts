const placeholders = /replace-me|replace-with|example\.com|user:password|your-/i;

function isIpv4Hostname(hostname: string): boolean {
  const parts = hostname.split('.');
  return parts.length === 4
    && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}

export function isAllowedIpPilotOrigin(value: string, allowInsecureHttpIp: boolean): boolean {
  if (!allowInsecureHttpIp) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'http:'
      && isIpv4Hostname(url.hostname)
      && url.port === ''
      && !url.username
      && !url.password
      && url.pathname === '/'
      && !url.search
      && !url.hash;
  } catch {
    return false;
  }
}

export function validatePublicEnvironment(values: NodeJS.ProcessEnv): string[] {
  const errors: string[] = [];
  const required = ['DATABASE_URL', 'JWT_SECRET', 'WEB_ORIGIN', 'VITE_API_BASE_URL'];
  for (const key of required) {
    const value = values[key] ?? '';
    if (!value) errors.push(`${key} is required`);
    if (placeholders.test(value)) errors.push(`${key} contains a placeholder value`);
  }
  if ((values.JWT_SECRET?.length ?? 0) < 32) errors.push('JWT_SECRET must be at least 32 characters');
  if (values.ALLOW_DEMO_AUTH !== 'false') errors.push('ALLOW_DEMO_AUTH must be false');

  const isIpPilot = isAllowedIpPilotOrigin(
    values.WEB_ORIGIN ?? '',
    values.ALLOW_INSECURE_HTTP_IP === 'true',
  ) && values.VITE_API_BASE_URL === '/api';

  if (!isIpPilot) {
    const origins = (values.WEB_ORIGIN ?? '').split(',').map((value) => value.trim()).filter(Boolean);
    if (origins.some((origin) => !origin.startsWith('https://'))) errors.push('WEB_ORIGIN must use HTTPS');

    const apiUrls = (values.VITE_API_BASE_URL ?? '').split(',').map((value) => value.trim()).filter(Boolean);
    if (apiUrls.some((url) => !url.startsWith('https://'))) errors.push('VITE_API_BASE_URL must use HTTPS');
  }

  return errors;
}
