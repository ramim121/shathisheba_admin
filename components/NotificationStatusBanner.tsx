"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, Mail, Smartphone, UsersRound } from "lucide-react";

export type NotificationStatus = {
  email_provider: "none" | "smtp" | "ses";
  push_fcm: boolean;
  push_expo: boolean;
  devices: number;
  users_with_email: number;
  users: number;
};

/** Loads provider status once; `null` until it arrives, `false` if it failed. */
export function useNotificationStatus() {
  const [status, setStatus] = useState<NotificationStatus | null | false>(null);
  useEffect(() => {
    let alive = true;
    fetch("/api/v1/admin/notifications/status", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => { if (alive) setStatus(j?.ok && j.data ? (j.data as NotificationStatus) : false); })
      .catch(() => { if (alive) setStatus(false); });
    return () => { alive = false; };
  }, []);
  return status;
}

const PROVIDER_LABEL: Record<string, string> = { smtp: "SMTP", ses: "Amazon SES" };

/**
 * Tells the admin, before they write anything, which channels will actually
 * reach a person. Without it an unconfigured email provider looks like a send
 * that silently vanished.
 */
export function NotificationStatusBanner({ compact = false, status: given }: { compact?: boolean; status?: NotificationStatus | null | false }) {
  const loaded = useNotificationStatus();
  const status = given === undefined ? loaded : given;

  if (status === null) return <div className="ntf-status is-loading">Checking email and push providers…</div>;
  if (status === false) {
    return (
      <div className="ntf-status is-loading is-failed">
        <AlertTriangle size={15} /> Could not read the notification provider status.
      </div>
    );
  }

  const emailOn = status.email_provider !== "none";
  const pushOn = status.push_fcm || status.push_expo;
  const pushVia = [status.push_fcm ? "Firebase" : "", status.push_expo ? "Expo" : ""].filter(Boolean).join(" + ");

  return (
    <div className={`ntf-status${compact ? " is-compact" : ""}${emailOn && pushOn ? " is-ok" : " is-warn"}`}>
      <div className={`ntf-status-item ${emailOn ? "ok" : "warn"}`}>
        <Mail size={15} />
        <div>
          <strong>{emailOn ? `Email via ${PROVIDER_LABEL[status.email_provider] ?? status.email_provider}` : "No email provider"}</strong>
          {emailOn ? null : (
            <span>
              Emails are queued in the {compact ? "delivery log" : <Link href="/notifications/log">delivery log</Link>} until an email provider is configured.
            </span>
          )}
        </div>
        {emailOn ? <CheckCircle2 size={14} className="ntf-status-tick" /> : null}
      </div>
      <div className={`ntf-status-item ${pushOn ? "ok" : "warn"}`}>
        <Smartphone size={15} />
        <div>
          <strong>{pushOn ? `Push via ${pushVia}` : "Push not set up"}</strong>
          {status.push_fcm ? null : <span>Push reaches phones once Firebase is set up.</span>}
        </div>
        {pushOn ? <CheckCircle2 size={14} className="ntf-status-tick" /> : null}
      </div>
      {compact ? null : (
        <div className="ntf-status-item neutral">
          <UsersRound size={15} />
          <div>
            <strong>{status.devices.toLocaleString()} phones registered</strong>
            <span>{status.users_with_email.toLocaleString()} of {status.users.toLocaleString()} users have an email address.</span>
          </div>
        </div>
      )}
    </div>
  );
}
