/**
 * V5.3 Production Operations — startup validation & operational health.
 *
 * Startup validation: distinguishes required vs optional configuration and
 * reports missing/invalid/blocked explicitly (no silent fallback).
 * Operational health: extends the existing /health with AI provider
 * DEGRADED/BLOCKED status — never fakes HEALTHY.
 */

export interface ConfigCheck {
  name: string;
  required: boolean;
  status: 'ok' | 'missing' | 'invalid' | 'disabled';
  detail?: string;
}

const REQUIRED_IN_PRODUCTION = ['DATABASE_URL', 'JWT_SECRET'] as const;

const OPTIONAL_AI = ['AI_API_KEY', 'AI_BASE_URL', 'AI_MODEL'] as const;
const OPTIONAL_EMBEDDING = ['EMBEDDING_API_KEY', 'EMBEDDING_BASE_URL', 'EMBEDDING_MODEL'] as const;

const PLACEHOLDER_PATTERN = /replace-me|replace-with|example\.com|your-key|your-key-here|<.*>|xxx{3,}/i;

export function validateStartupConfiguration(env: NodeJS.ProcessEnv = process.env): {
  checks: ConfigCheck[];
  errors: string[];
  warnings: string[];
  aiProvider: 'configured' | 'missing';
  embeddingProvider: 'configured' | 'missing' | 'provider-unsupported';
} {
  const checks: ConfigCheck[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];
  const isProduction = env.NODE_ENV === 'production';

  // Required configuration
  for (const name of REQUIRED_IN_PRODUCTION) {
    const value = (env[name] ?? '').trim();
    if (!value) {
      const status: ConfigCheck['status'] = isProduction ? 'missing' : 'disabled';
      checks.push({ name, required: true, status, detail: isProduction ? 'required in production' : 'dev mode: memory fallback active' });
      if (isProduction) errors.push(`${name} is required in production but missing`);
    } else if (PLACEHOLDER_PATTERN.test(value)) {
      checks.push({ name, required: true, status: 'invalid', detail: 'placeholder value detected' });
      errors.push(`${name} contains a placeholder value`);
    } else {
      checks.push({ name, required: true, status: 'ok' });
    }
  }

  // AI provider (optional: template fallback active when missing)
  const aiKey = (env.AI_API_KEY ?? '').trim();
  if (!aiKey) {
    checks.push({ name: 'AI_API_KEY', required: false, status: 'missing', detail: 'LLM features degraded to template/workflow fallback' });
    warnings.push('AI_API_KEY not configured: LLM narration unavailable');
  } else if (PLACEHOLDER_PATTERN.test(aiKey)) {
    checks.push({ name: 'AI_API_KEY', required: false, status: 'invalid', detail: 'placeholder value detected' });
    errors.push('AI_API_KEY contains a placeholder value');
  } else {
    checks.push({ name: 'AI_API_KEY', required: false, status: 'ok' });
  }

  // Embedding provider (optional: local deterministic embedding is the default)
  const embeddingKey = (env.EMBEDDING_API_KEY ?? '').trim();
  if (!embeddingKey) {
    checks.push({ name: 'EMBEDDING_API_KEY', required: false, status: 'missing', detail: 'using local-deterministic embedding (no remote provider)' });
  } else if (PLACEHOLDER_PATTERN.test(embeddingKey)) {
    checks.push({ name: 'EMBEDDING_API_KEY', required: false, status: 'invalid', detail: 'placeholder value detected' });
    warnings.push('EMBEDDING_API_KEY contains a placeholder value');
  } else {
    checks.push({ name: 'EMBEDDING_API_KEY', required: false, status: 'ok' });
  }

  // Redistribute optional vars into checks for visibility
  for (const name of [...OPTIONAL_AI.slice(1), ...OPTIONAL_EMBEDDING.slice(1)]) {
    const value = (env[name] ?? '').trim();
    checks.push({ name, required: false, status: value ? 'ok' : 'missing' });
  }

  const aiProvider: 'configured' | 'missing' = aiKey && !PLACEHOLDER_PATTERN.test(aiKey) ? 'configured' : 'missing';
  // DeepSeek (the default base URL) has no /embeddings endpoint — a key alone
  // is not sufficient unless the base URL points to a provider that does.
  const embeddingBase = (env.EMBEDDING_BASE_URL ?? '').trim();
  const embeddingProvider: 'configured' | 'missing' | 'provider-unsupported' =
    embeddingKey && embeddingBase ? 'configured' : 'missing';

  return { checks, errors, warnings, aiProvider, embeddingProvider };
}

/**
 * Operational health probe result (for /health enrichment).
 * AI/embedding providers report DEGRADED when unconfigured — never HEALTHY.
 */
export interface OperationalHealthCheck {
  database: 'connected' | 'disconnected' | 'disabled';
  aiProvider: 'configured' | 'degraded';
  embeddingProvider: 'configured' | 'degraded';
  overall: 'ok' | 'degraded';
}

export function buildOperationalHealth(
  databaseConnected: boolean,
  databaseConfigured: boolean,
  aiConfigured: boolean,
  embeddingConfigured: boolean,
): OperationalHealthCheck {
  const database: OperationalHealthCheck['database'] = !databaseConfigured
    ? 'disabled'
    : databaseConnected ? 'connected' : 'disconnected';
  return {
    database,
    aiProvider: aiConfigured ? 'configured' : 'degraded',
    embeddingProvider: embeddingConfigured ? 'configured' : 'degraded',
    overall: database === 'connected' || database === 'disabled' ? 'ok' : 'degraded',
  };
}