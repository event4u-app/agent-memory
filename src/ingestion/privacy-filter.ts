import { homedir } from "node:os";

/**
 * Pre-storage privacy filter.
 * Runs BEFORE embedding creation, BEFORE storage, BEFORE any processing.
 * Non-negotiable — see Safety Rule in roadmap.
 *
 * Strips:
 * 1. API keys, tokens, passwords, connection strings (regex + entropy)
 * 2. PII: emails, phone numbers
 * 3. <private>...</private> tagged content
 * 4. File paths: normalize to relative, strip home directory
 * 5. .env content: never stored verbatim
 */

// --- Patterns ---

const PRIVATE_TAG_RE = /<private>[\s\S]*?<\/private>/gi;

const SECRET_PATTERNS: RegExp[] = [
  // API keys / tokens (generic)
  /(?:api[_-]?key|token|secret|password|passwd|pwd|auth|bearer)\s*[:=]\s*['"]?[A-Za-z0-9_\-/.+=]{16,}['"]?/gi,
  // AWS keys
  /AKIA[0-9A-Z]{16}/g,
  // JWT tokens
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
  // Connection strings
  /(?:postgres(?:ql)?|mysql|redis|mongodb):\/\/[^\s'"]+/gi,
  // Private keys
  /-----BEGIN (?:RSA |EC |DSA )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |DSA )?PRIVATE KEY-----/g,
  // GitHub tokens
  /gh[ps]_[A-Za-z0-9_]{36,}/g,
  // npm tokens
  /npm_[A-Za-z0-9]{36,}/g,
];

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const PHONE_RE = /(?:\+?\d{1,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}/g;

// .env lines: KEY=value
const ENV_LINE_RE = /^[A-Z][A-Z0-9_]*\s*=\s*.+$/gm;

// High-entropy string detection (potential secrets)
const HIGH_ENTROPY_THRESHOLD = 4.0;
const HIGH_ENTROPY_MIN_LENGTH = 20;

// --- Filter Functions ---

/** Strip <private>...</private> tagged content */
export function stripPrivateTags(text: string): string {
  return text.replace(PRIVATE_TAG_RE, "[REDACTED:private]");
}

/** Strip secrets: API keys, tokens, passwords, connection strings */
export function stripSecrets(text: string): string {
  let result = text;
  for (const pattern of SECRET_PATTERNS) {
    result = result.replace(pattern, "[REDACTED:secret]");
  }
  return result;
}

/** Strip PII: email addresses, phone numbers */
export function stripPII(text: string): string {
  return text.replace(EMAIL_RE, "[REDACTED:email]").replace(PHONE_RE, "[REDACTED:phone]");
}

/** Strip .env-style KEY=VALUE lines */
export function stripEnvValues(text: string): string {
  return text.replace(ENV_LINE_RE, (match) => {
    const key = match.split("=")[0]!.trim();
    return `${key}=[REDACTED:env]`;
  });
}

/** Normalize file paths: relative paths, strip home directory */
export function normalizePaths(text: string): string {
  const home = homedir();
  // Replace home directory with ~
  let result = text.replaceAll(home, "~");
  // Replace common absolute paths
  result = result.replace(/\/Users\/[^/\s]+/g, "~");
  result = result.replace(/\/home\/[^/\s]+/g, "~");
  result = result.replace(/C:\\Users\\[^\\]+/g, "~");
  return result;
}

/** Calculate Shannon entropy of a string */
export function shannonEntropy(str: string): number {
  if (str.length === 0) return 0;
  const freq = new Map<string, number>();
  for (const char of str) {
    freq.set(char, (freq.get(char) ?? 0) + 1);
  }
  let entropy = 0;
  for (const count of freq.values()) {
    const p = count / str.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

/** Detect and redact high-entropy strings (potential leaked secrets) */
export function stripHighEntropyStrings(text: string): string {
  return text.replace(/['"][A-Za-z0-9+/=_\-]{20,}['"]/g, (match) => {
    const inner = match.slice(1, -1);
    if (inner.length >= HIGH_ENTROPY_MIN_LENGTH && shannonEntropy(inner) > HIGH_ENTROPY_THRESHOLD) {
      return `"[REDACTED:high-entropy]"`;
    }
    return match;
  });
}

// --- Main Filter ---

export interface PrivacyFilterOptions {
  stripPii?: boolean;
  stripEnv?: boolean;
  stripHighEntropy?: boolean;
}

/**
 * Apply all privacy filters to the given text.
 * Order matters: private tags first, then secrets, then PII, then paths.
 */
export function applyPrivacyFilter(
  text: string,
  options: PrivacyFilterOptions = {},
): string {
  const { stripPii = true, stripEnv = true, stripHighEntropy = true } = options;

  let result = stripPrivateTags(text);
  result = stripSecrets(result);
  if (stripPii) result = stripPII(result);
  if (stripEnv) result = stripEnvValues(result);
  if (stripHighEntropy) result = stripHighEntropyStrings(result);
  result = normalizePaths(result);

  return result;
}
