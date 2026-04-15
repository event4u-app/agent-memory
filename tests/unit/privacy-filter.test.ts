import { describe, it, expect } from "vitest";
import {
  applyPrivacyFilter,
  stripSecrets,
  stripPII,
  stripPrivateTags,
  stripEnvValues,
  normalizePaths,
  shannonEntropy,
} from "../../src/ingestion/privacy-filter.js";

describe("Privacy Filter", () => {
  describe("stripPrivateTags", () => {
    it("removes <private> tagged content", () => {
      const input = "before <private>secret stuff</private> after";
      expect(stripPrivateTags(input)).toBe("before [REDACTED:private] after");
    });

    it("handles multiple tags", () => {
      const input = "<private>a</private> middle <private>b</private>";
      expect(stripPrivateTags(input)).toBe("[REDACTED:private] middle [REDACTED:private]");
    });

    it("is case insensitive", () => {
      const input = "<PRIVATE>secret</PRIVATE>";
      expect(stripPrivateTags(input)).toBe("[REDACTED:private]");
    });
  });

  describe("stripSecrets", () => {
    it("redacts API key patterns", () => {
      const input = 'api_key: "sk-abc123def456ghi789jkl012"';
      expect(stripSecrets(input)).toContain("[REDACTED:secret]");
    });

    it("redacts connection strings", () => {
      const input = "postgresql://user:pass@host:5432/db";
      expect(stripSecrets(input)).toContain("[REDACTED:secret]");
    });

    it("redacts JWT tokens", () => {
      const input = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
      expect(stripSecrets(input)).toContain("[REDACTED:secret]");
    });

    it("redacts GitHub tokens", () => {
      const input = "token: ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij";
      expect(stripSecrets(input)).toContain("[REDACTED:secret]");
    });

    it("leaves normal text untouched", () => {
      const input = "This is a normal description of an architecture decision";
      expect(stripSecrets(input)).toBe(input);
    });
  });

  describe("stripPII", () => {
    it("redacts email addresses", () => {
      const input = "Contact john.doe@example.com for details";
      expect(stripPII(input)).toContain("[REDACTED:email]");
      expect(stripPII(input)).not.toContain("john.doe@example.com");
    });
  });

  describe("stripEnvValues", () => {
    it("redacts .env KEY=VALUE lines", () => {
      const input = "DB_PASSWORD=supersecret123\nAPP_KEY=base64:abc123";
      const result = stripEnvValues(input);
      expect(result).toContain("DB_PASSWORD=[REDACTED:env]");
      expect(result).toContain("APP_KEY=[REDACTED:env]");
      expect(result).not.toContain("supersecret123");
    });

    it("leaves normal text untouched", () => {
      const input = "This uses DB_PASSWORD in the config";
      expect(stripEnvValues(input)).toBe(input);
    });
  });

  describe("normalizePaths", () => {
    it("replaces /Users/username with ~", () => {
      const input = "/Users/johndoe/projects/my-app/src/index.ts";
      expect(normalizePaths(input)).toMatch(/^~\//);
      expect(normalizePaths(input)).not.toContain("johndoe");
    });
  });

  describe("shannonEntropy", () => {
    it("returns 0 for empty string", () => {
      expect(shannonEntropy("")).toBe(0);
    });

    it("returns 0 for single character repeated", () => {
      expect(shannonEntropy("aaaa")).toBe(0);
    });

    it("returns high entropy for random-looking string", () => {
      expect(shannonEntropy("aB3$kL9m!pQ2")).toBeGreaterThan(3.0);
    });
  });

  describe("applyPrivacyFilter (combined)", () => {
    it("applies all filters in sequence", () => {
      const input = '<private>my-password-here</private> api_key="sk-test123456789abc" user@email.com /Users/dev/project DB_HOST=localhost';
      const result = applyPrivacyFilter(input);
      expect(result).not.toContain("my-password-here");
      expect(result).not.toContain("user@email.com");
      expect(result).toContain("[REDACTED:");
    });
  });
});
