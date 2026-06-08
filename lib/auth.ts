import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

// Password hashing for app_users.password_hash, using Node's built-in scrypt
// (no external dependency). Stored format: scrypt$<saltHex>$<hashHex>.

const KEYLEN = 64;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, KEYLEN);
  return `scrypt$${salt.toString("hex")}$${derived.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string | null | undefined): boolean {
  if (!stored) return false;
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const salt = Buffer.from(parts[1], "hex");
  const expected = Buffer.from(parts[2], "hex");
  const derived = scryptSync(password, salt, expected.length || KEYLEN);
  return expected.length === derived.length && timingSafeEqual(expected, derived);
}

export function generateToken(): string {
  return randomBytes(32).toString("hex");
}
