// Errors the API layer must translate into something other than a 500.
// The route's generic catch reports every throw as a database failure, which is
// the right default for this codebase but wrong for a deliberate refusal.

export class RateLimitError extends Error {
  readonly retryAfterSeconds: number;

  constructor(message: string, retryAfterSeconds: number) {
    super(message);
    this.name = "RateLimitError";
    this.retryAfterSeconds = Math.max(1, Math.ceil(retryAfterSeconds));
  }
}

// The endpoint helpers signal bad input by throwing a plain Error with a message
// written for the user ("Phone and code are required.", "Incorrect code."). Those
// were all reported as HTTP 500 with source:"mysql", so the mobile app showed a
// server-failure message for what was really the user's typo — and a genuine
// database outage looked identical to a missing field.
//
// mysql2 tags its own failures with errno/sqlState/sqlMessage. Anything carrying
// those is a real database fault; anything else that reaches the route from our
// own code is input validation.
export function isDatabaseError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { errno?: unknown; sqlState?: unknown; sqlMessage?: unknown; code?: unknown };
  if (e.errno !== undefined || e.sqlState !== undefined || e.sqlMessage !== undefined) return true;
  // Connection-level failures surface as errno-less codes such as ECONNREFUSED.
  return typeof e.code === "string" && /^(E[A-Z]+|PROTOCOL_|POOL_)/.test(e.code);
}
