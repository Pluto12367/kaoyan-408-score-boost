const placeholders = /replace-me|replace-with|example\.com|user:password|your-/i;
const httpIpv4Origin = /^http:\/\/((?:0|[1-9]\d{0,2})(?:\.(?:0|[1-9]\d{0,2})){3})\/?$/;

export function isGloballyReachableIpv4(hostname: string): boolean {
  const parts = hostname.split('.');
  if (
    parts.length !== 4
    || parts.some((part) => !/^(?:0|[1-9]\d{0,2})$/.test(part) || Number(part) > 255)
  ) {
    return false;
  }

  const [first, second, third] = parts.map(Number);
  return !(
    first === 0
    || first === 10
    || (first === 100 && second >= 64 && second <= 127)
    || first === 127
    || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 0 && (third === 0 || third === 2))
    || (first === 192 && second === 88 && third === 99)
    || (first === 192 && second === 168)
    || (first === 198 && second >= 18 && second <= 19)
    || (first === 198 && second === 51 && third === 100)
    || (first === 203 && second === 0 && third === 113)
    || first >= 224
  );
}

export function isAllowedIpPilotOrigin(value: string, allowInsecureHttpIp: boolean): boolean {
  if (!allowInsecureHttpIp) return false;
  const match = httpIpv4Origin.exec(value);
  return match !== null && isGloballyReachableIpv4(match[1]);
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
