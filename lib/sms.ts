// BulkSMSBD gateway helper. api_key/sender stay server-side (never in the app).
// GET https://bulksmsbd.net/api/smsapi?api_key=KEY&type=text&number=88017...&senderid=ID&message=...
// Returns the gateway's response code (202 = submitted). See PDF error/success codes.
//
// HTTPS, not HTTP. The API key and the recipient's phone number travel in the
// query string, so over plaintext every hop between this server and the gateway
// could read the key and harvest numbers. The gateway answers on 443, so there
// was no reason for the cleartext call.

export function normalizeBdNumber(phone: string): string {
  const digits = String(phone).replace(/\D/g, "");
  if (digits.startsWith("880")) return digits;
  if (digits.startsWith("0")) return `88${digits}`;
  if (digits.startsWith("1") && digits.length === 10) return `880${digits}`;
  return digits;
}

export function isSmsDevMode(): boolean {
  return String(process.env.OTP_DEV_MODE ?? "").toLowerCase() === "true";
}

export type SmsResult = { ok: boolean; code: string | null; raw: string; skipped?: boolean };

export async function sendSms(number: string, message: string): Promise<SmsResult> {
  if (isSmsDevMode()) {
    return { ok: true, code: "dev", raw: "dev-mode: SMS not sent", skipped: true };
  }
  const apiKey = process.env.BULKSMSBD_API_KEY;
  const senderId = process.env.BULKSMSBD_SENDER_ID;
  if (!apiKey || !senderId) {
    throw new Error("SMS gateway is not configured (BULKSMSBD_API_KEY / BULKSMSBD_SENDER_ID).");
  }
  const url =
    `https://bulksmsbd.net/api/smsapi?api_key=${encodeURIComponent(apiKey)}` +
    `&type=text&number=${encodeURIComponent(normalizeBdNumber(number))}` +
    `&senderid=${encodeURIComponent(senderId)}&message=${encodeURIComponent(message)}`;

  const response = await fetch(url, { method: "GET" });
  const raw = await response.text();
  // The gateway returns a JSON-ish or plain code; 202 indicates success.
  const codeMatch = raw.match(/\b(\d{3,4})\b/);
  const code = codeMatch ? codeMatch[1] : null;
  return { ok: code === "202", code, raw };
}
