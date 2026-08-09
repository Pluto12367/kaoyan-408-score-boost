import { createHash } from 'node:crypto';

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = canonicalize(value[key]);
    return out;
  }
  return value;
}

/**
 * Single canonical JSON → SHA256 utility. Key order never affects the hash;
 * identical logical input always yields the same hex digest. All manifest and
 * config hashing must go through this one implementation.
 */
export function canonicalJsonHash(value) {
  return createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex');
}
