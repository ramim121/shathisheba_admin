import crypto from "crypto";

/**
 * Push to phones. A device token is one of two kinds:
 *   expo — "ExponentPushToken[…]", sent through Expo's push service (needs the
 *          app's Firebase key uploaded to Expo; EXPO_ACCESS_TOKEN optional);
 *   fcm  — a native Firebase token, sent straight to FCM v1 with the service
 *          account in FCM_SERVICE_ACCOUNT_JSON (raw JSON or base64). No Expo
 *          account involved.
 * Without Firebase configured, FCM sends come back "skipped" and are logged.
 */

export type PushDevice = { id: number; token: string; provider: "expo" | "fcm" };
export type PushMessage = { title: string; body: string; data?: Record<string, string> };
export type PushResult = { deviceId: number; token: string; status: "sent" | "skipped" | "failed"; error?: string; deactivate?: boolean };

type ServiceAccount = { project_id: string; client_email: string; private_key: string };

function fcmAccount(): ServiceAccount | null {
  const raw = process.env.FCM_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  try {
    const json = raw.trim().startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8");
    const account = JSON.parse(json) as ServiceAccount;
    return account.project_id && account.client_email && account.private_key ? account : null;
  } catch {
    return null;
  }
}

export function pushProviders() {
  return { fcm: Boolean(fcmAccount()), expo: true };
}

const b64url = (v: string | Buffer) => Buffer.from(v).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");

let fcmToken: { value: string; expires: number } | null = null;

// OAuth access token for FCM from a signed JWT — what google-auth-library does,
// without the dependency.
async function fcmAccessToken(account: ServiceAccount): Promise<string> {
  if (fcmToken && fcmToken.expires > Date.now() + 60_000) return fcmToken.value;
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(JSON.stringify({
    iss: account.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600
  }));
  const signature = crypto.createSign("RSA-SHA256").update(`${header}.${claims}`).sign(account.private_key.replace(/\\n/g, "\n"));
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${header}.${claims}.${b64url(signature)}` })
  });
  const json = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error_description?: string; error?: string };
  if (!res.ok || !json.access_token) throw new Error(json.error_description || json.error || `FCM token request failed (${res.status})`);
  fcmToken = { value: json.access_token, expires: Date.now() + (json.expires_in ?? 3600) * 1000 };
  return fcmToken.value;
}

async function sendExpo(devices: PushDevice[], msg: PushMessage): Promise<PushResult[]> {
  const out: PushResult[] = [];
  for (let i = 0; i < devices.length; i += 100) {
    const batch = devices.slice(i, i + 100);
    try {
      const res = await fetch("https://exp.host/--/api/v2/push/send", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          ...(process.env.EXPO_ACCESS_TOKEN ? { Authorization: `Bearer ${process.env.EXPO_ACCESS_TOKEN}` } : {})
        },
        body: JSON.stringify(batch.map((d) => ({ to: d.token, title: msg.title, body: msg.body, data: msg.data ?? {}, sound: "default", channelId: "default", priority: "high" })))
      });
      const json = (await res.json().catch(() => ({}))) as { data?: Array<{ status: string; message?: string; details?: { error?: string } }> };
      batch.forEach((d, k) => {
        const r = json.data?.[k];
        if (r?.status === "ok") out.push({ deviceId: d.id, token: d.token, status: "sent" });
        else out.push({
          deviceId: d.id,
          token: d.token,
          status: "failed",
          error: (r?.message || `Expo push failed (${res.status})`).slice(0, 480),
          deactivate: r?.details?.error === "DeviceNotRegistered"
        });
      });
    } catch (error) {
      batch.forEach((d) => out.push({ deviceId: d.id, token: d.token, status: "failed", error: String(error).slice(0, 480) }));
    }
  }
  return out;
}

async function sendFcm(devices: PushDevice[], msg: PushMessage): Promise<PushResult[]> {
  const account = fcmAccount();
  if (!account) {
    return devices.map((d) => ({ deviceId: d.id, token: d.token, status: "skipped", error: "Firebase not configured (FCM_SERVICE_ACCOUNT_JSON)." }));
  }
  let access: string;
  try {
    access = await fcmAccessToken(account);
  } catch (error) {
    return devices.map((d) => ({ deviceId: d.id, token: d.token, status: "failed", error: String(error).slice(0, 480) }));
  }
  const data = Object.fromEntries(Object.entries(msg.data ?? {}).map(([k, v]) => [k, String(v)]));
  return Promise.all(devices.map(async (d): Promise<PushResult> => {
    try {
      const res = await fetch(`https://fcm.googleapis.com/v1/projects/${account.project_id}/messages:send`, {
        method: "POST",
        headers: { Authorization: `Bearer ${access}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          message: {
            token: d.token,
            notification: { title: msg.title, body: msg.body },
            data,
            android: { priority: "high", notification: { channel_id: "default", sound: "default" } }
          }
        })
      });
      if (res.ok) return { deviceId: d.id, token: d.token, status: "sent" };
      const json = (await res.json().catch(() => ({}))) as { error?: { message?: string; status?: string; details?: Array<{ errorCode?: string }> } };
      const code = json.error?.details?.find((x) => x.errorCode)?.errorCode ?? json.error?.status;
      return {
        deviceId: d.id,
        token: d.token,
        status: "failed",
        error: (json.error?.message || `FCM ${res.status}`).slice(0, 480),
        deactivate: code === "UNREGISTERED" || res.status === 404
      };
    } catch (error) {
      return { deviceId: d.id, token: d.token, status: "failed", error: String(error).slice(0, 480) };
    }
  }));
}

export async function sendPush(devices: PushDevice[], msg: PushMessage): Promise<PushResult[]> {
  const [expo, fcm] = await Promise.all([
    sendExpo(devices.filter((d) => d.provider === "expo"), msg),
    sendFcm(devices.filter((d) => d.provider === "fcm"), msg)
  ]);
  return [...expo, ...fcm];
}
