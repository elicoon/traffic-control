/**
 * Sensitive data redaction utilities
 * Automatically masks tokens, keys, secrets, and other sensitive fields
 */

// Default fields to redact (case-insensitive matching)
const DEFAULT_REDACT_FIELDS = [
  'token',
  'password',
  'secret',
  'key',
  'apikey',
  'api_key',
  'authorization',
  'auth',
  'credential',
  'private',
  'jwt',
  'bearer',
  'session_token',
  'access_token',
  'refresh_token',
  'signing_secret',
  'service_key',
  'bot_token',
];

// Patterns that look like sensitive values
const SENSITIVE_PATTERNS = [
  /^xox[boaprs]-[a-zA-Z0-9-]+$/,  // Slack tokens
  /^sk-[a-zA-Z0-9]+$/,            // OpenAI/Anthropic keys
  /^ghp_[a-zA-Z0-9]+$/,           // GitHub tokens
  /^eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/,  // JWT tokens
];

const REDACTED = '[REDACTED]';

/**
 * Check if a field name should be redacted
 */
function shouldRedactField(fieldName: string, customFields: string[]): boolean {
  const normalizedName = fieldName.toLowerCase();
  const allFields = [...DEFAULT_REDACT_FIELDS, ...customFields.map(f => f.toLowerCase())];

  return allFields.some(field => normalizedName.includes(field));
}

/**
 * Check if a value looks like a sensitive token
 */
function looksLikeSensitiveValue(value: string): boolean {
  if (typeof value !== 'string') return false;
  return SENSITIVE_PATTERNS.some(pattern => pattern.test(value));
}

/**
 * Redact sensitive fields from an object
 * Returns a new object with sensitive values replaced with [REDACTED]
 */
export function redact(
  obj: Record<string, unknown>,
  customFields: string[] = []
): Record<string, unknown> {
  if (!obj || typeof obj !== 'object') {
    return obj;
  }

  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    if (shouldRedactField(key, customFields)) {
      result[key] = REDACTED;
    } else if (typeof value === 'string' && looksLikeSensitiveValue(value)) {
      result[key] = REDACTED;
    } else if (Array.isArray(value)) {
      result[key] = value.map(item => {
        if (typeof item === 'object' && item !== null) {
          return redact(item as Record<string, unknown>, customFields);
        }
        if (typeof item === 'string' && looksLikeSensitiveValue(item)) {
          return REDACTED;
        }
        return item;
      });
    } else if (typeof value === 'object' && value !== null) {
      result[key] = redact(value as Record<string, unknown>, customFields);
    } else {
      result[key] = value;
    }
  }

  return result;
}

/**
 * Redact a single string value if it looks sensitive
 */
export function redactValue(value: string): string {
  if (looksLikeSensitiveValue(value)) {
    return REDACTED;
  }
  return value;
}

/**
 * Get the list of default redaction fields
 */
export function getDefaultRedactFields(): string[] {
  return [...DEFAULT_REDACT_FIELDS];
}
