import { VALID_TRANSITIONS, type TrustStatus } from "../types.js";

export class InvalidTransitionError extends Error {
  constructor(from: TrustStatus, to: TrustStatus) {
    super(`Invalid status transition: ${from} → ${to}`);
    this.name = "InvalidTransitionError";
  }
}

/**
 * Validate and enforce a status transition.
 * Throws InvalidTransitionError if the transition is not allowed.
 */
export function validateTransition(from: TrustStatus, to: TrustStatus): void {
  const allowed = VALID_TRANSITIONS[from];
  if (!allowed.includes(to)) {
    throw new InvalidTransitionError(from, to);
  }
}

/**
 * Check if a transition is valid without throwing.
 */
export function isValidTransition(from: TrustStatus, to: TrustStatus): boolean {
  return VALID_TRANSITIONS[from].includes(to);
}

/**
 * Special case: any status can transition to 'poisoned'.
 * This is checked separately because it's a safety override.
 */
export function canPoison(status: TrustStatus): boolean {
  return status !== "archived" && status !== "poisoned";
}
