import { describe, it, expect } from "vitest";
import { validateTransition, isValidTransition, canPoison, InvalidTransitionError } from "../../src/trust/transitions.js";

describe("Status Transitions", () => {
  describe("validateTransition", () => {
    it("allows quarantine → validated", () => {
      expect(() => validateTransition("quarantine", "validated")).not.toThrow();
    });

    it("allows quarantine → rejected", () => {
      expect(() => validateTransition("quarantine", "rejected")).not.toThrow();
    });

    it("allows validated → stale", () => {
      expect(() => validateTransition("validated", "stale")).not.toThrow();
    });

    it("allows stale → validated (revalidation)", () => {
      expect(() => validateTransition("stale", "validated")).not.toThrow();
    });

    it("allows validated → invalidated", () => {
      expect(() => validateTransition("validated", "invalidated")).not.toThrow();
    });

    it("rejects quarantine → stale (not a valid transition)", () => {
      expect(() => validateTransition("quarantine", "stale")).toThrow(InvalidTransitionError);
    });

    it("rejects validated → quarantine (cannot go back to quarantine)", () => {
      expect(() => validateTransition("validated", "quarantine")).toThrow(InvalidTransitionError);
    });

    it("rejects archived → anything (terminal state)", () => {
      expect(() => validateTransition("archived", "validated")).toThrow(InvalidTransitionError);
      expect(() => validateTransition("archived", "stale")).toThrow(InvalidTransitionError);
    });

    it("allows any non-terminal state → poisoned", () => {
      expect(() => validateTransition("validated", "poisoned")).not.toThrow();
      expect(() => validateTransition("stale", "poisoned")).not.toThrow();
    });

    it("rejects poisoned → validated (can only go to archived)", () => {
      expect(() => validateTransition("poisoned", "validated")).toThrow(InvalidTransitionError);
    });

    it("allows poisoned → archived", () => {
      expect(() => validateTransition("poisoned", "archived")).not.toThrow();
    });
  });

  describe("isValidTransition", () => {
    it("returns true for valid transitions", () => {
      expect(isValidTransition("quarantine", "validated")).toBe(true);
      expect(isValidTransition("validated", "stale")).toBe(true);
    });

    it("returns false for invalid transitions", () => {
      expect(isValidTransition("quarantine", "stale")).toBe(false);
      expect(isValidTransition("archived", "validated")).toBe(false);
    });
  });

  describe("canPoison", () => {
    it("returns true for active statuses", () => {
      expect(canPoison("validated")).toBe(true);
      expect(canPoison("stale")).toBe(true);
      expect(canPoison("quarantine")).toBe(true);
      expect(canPoison("invalidated")).toBe(true);
    });

    it("returns false for terminal statuses", () => {
      expect(canPoison("archived")).toBe(false);
      expect(canPoison("poisoned")).toBe(false);
    });
  });
});
