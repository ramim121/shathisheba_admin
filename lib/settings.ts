import { queryRows } from "@/lib/db";

/**
 * Platform switches, read from `app_settings`.
 *
 * A single request can consult half a dozen switches (every geo filter reads
 * its scope), so values are held for a few seconds rather than re-queried each
 * time. The window is short enough that a change in the admin is visible
 * almost at once, and a write through the admin clears it immediately.
 *
 * A missing key falls back to the caller's default rather than throwing — a
 * switch nobody has set yet behaves like its default.
 */

const TTL_MS = 10_000;
let cache: { at: number; values: Map<string, string | null> } | null = null;

async function all(): Promise<Map<string, string | null>> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.values;
  try {
    const rows = await queryRows<{ setting_key: string; value_text: string | null }>(
      "SELECT setting_key, value_text FROM app_settings"
    );
    cache = { at: Date.now(), values: new Map(rows.map((r) => [r.setting_key, r.value_text])) };
  } catch {
    // The table may not exist on an environment that has not run migration
    // 030. Behaving like the defaults is the safe read.
    cache = { at: Date.now(), values: new Map() };
  }
  return cache.values;
}

/** Drop the cached values; called after any write to app_settings. */
export function invalidateSettings() {
  cache = null;
}

export async function getSetting(key: string, fallback: string): Promise<string> {
  const value = (await all()).get(key);
  return value === null || value === undefined || value === "" ? fallback : String(value);
}

/** "1", "true", "yes" and "on" are true; everything else is false. */
export async function getBoolSetting(key: string, fallback: boolean): Promise<boolean> {
  const raw = (await getSetting(key, fallback ? "1" : "0")).trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}
