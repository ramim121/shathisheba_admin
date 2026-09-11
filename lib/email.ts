import type { Transporter } from "nodemailer";

/**
 * Outgoing email. Two providers, chosen by environment:
 *   SMTP  — SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS (a company mailbox)
 *   SES   — EMAIL_PROVIDER=ses (+ SES_REGION / SES_ACCESS_KEY_ID /
 *           SES_SECRET_ACCESS_KEY, falling back to the S3 keys)
 * EMAIL_FROM sets the sender for either. With neither configured every email
 * is recorded in the outbox as "skipped", so nothing is lost and the admin can
 * see exactly what would have gone out.
 */

export type EmailProvider = "none" | "smtp" | "ses";
export type EmailResult = { status: "sent" | "skipped" | "failed"; error?: string };

export function emailProvider(): EmailProvider {
  if (process.env.SMTP_HOST && process.env.SMTP_USER) return "smtp";
  if ((process.env.EMAIL_PROVIDER ?? "").toLowerCase() === "ses" && process.env.EMAIL_FROM) return "ses";
  return "none";
}

export function emailFrom(): string {
  return process.env.EMAIL_FROM || process.env.SMTP_USER || "Shathi Sheba <noreply@digigramventures.com>";
}

let smtp: Transporter | null = null;

export async function sendEmail(to: string, subject: string, html: string, text: string): Promise<EmailResult> {
  const provider = emailProvider();
  if (provider === "none") {
    return { status: "skipped", error: "No email provider configured (set SMTP_* or EMAIL_PROVIDER=ses)." };
  }
  try {
    if (provider === "smtp") {
      if (!smtp) {
        const nodemailer = await import("nodemailer");
        const port = Number(process.env.SMTP_PORT ?? 587);
        smtp = nodemailer.createTransport({
          host: process.env.SMTP_HOST,
          port,
          secure: port === 465,
          auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        });
      }
      await smtp.sendMail({ from: emailFrom(), to, subject, html, text });
    } else {
      const { SESv2Client, SendEmailCommand } = await import("@aws-sdk/client-sesv2");
      const client = new SESv2Client({
        region: process.env.SES_REGION || process.env.S3_BUCKET_REGION || "ap-southeast-1",
        credentials: {
          accessKeyId: (process.env.SES_ACCESS_KEY_ID || process.env.S3_ACCESS_KEY_ID) as string,
          secretAccessKey: (process.env.SES_SECRET_ACCESS_KEY || process.env.S3_SECRET_ACCESS_KEY) as string
        }
      });
      await client.send(new SendEmailCommand({
        FromEmailAddress: emailFrom(),
        Destination: { ToAddresses: [to] },
        Content: {
          Simple: {
            Subject: { Data: subject, Charset: "UTF-8" },
            Body: { Html: { Data: html, Charset: "UTF-8" }, Text: { Data: text, Charset: "UTF-8" } }
          }
        }
      }));
    }
    return { status: "sent" };
  } catch (error) {
    return { status: "failed", error: (error instanceof Error ? error.message : String(error)).slice(0, 480) };
  }
}
