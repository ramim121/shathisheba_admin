import { queryRows } from "@/lib/db";

/**
 * Platform switches, read from `app_settings`.
 *
 * Deliberately not cached: these are read a handful of times per request at
 * most, and a stale switch that stays wrong until a restart is worse than the
 * query. A missing key falls back to the caller's default rather than throwing —
 * a switch nobody has set yet should behave like its default, not take the
 * endpoint down.
 */

export async function getSetting(key: string, fallback: string): Promise<string> {
  try {
    const rows = await queryRows<{ value_text: string | null }>(
      "SELECT value_text FROM app_settings WHERE setting_key = ? LIMIT 1",
      [key]
    );
    const value = rows[0]?.value_text;
    return value === null || value === undefined || value === "" ? fallback : String(value);
  } catch {
    // The table may not exist yet on an environment that has not run migration
    // 030. Behaving like the default is the safe read.
    return fallback;
  }
}

/** "1", "true", "yes" and "on" are true; everything else is false. */
export async function getBoolSetting(key: string, fallback: boolean): Promise<boolean> {
  const raw = (await getSetting(key, fallback ? "1" : "0")).trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}
