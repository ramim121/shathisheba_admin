"use client";

import { useEffect, useState } from "react";
import { Bell } from "lucide-react";
import { fromLookup, type SelectOption } from "@/components/Select";
import type { LookupOption } from "@/lib/admin-lookups";

/**
 * Pieces shared by the template editor and the broadcast composer: the phone
 * mock-up, soft character limits, and the user / role pickers' options.
 */

// Android truncates a collapsed notification's title around here and its body
// after roughly two lines; past these the farmer never sees the rest.
export const PUSH_TITLE_LIMIT = 65;
export const PUSH_BODY_LIMIT = 240;

export const ROLE_OPTIONS: SelectOption[] = [
  { value: "shathisheba_seller", label: "Sellers" },
  { value: "shathisheba_buyer", label: "Buyers" },
  { value: "field_officer", label: "Field officers" },
  { value: "project_member", label: "Project members" }
];

/** Code points, not UTF-16 units — Bangla conjuncts would otherwise over-count. */
export function charLength(text: string) {
  return [...text].length;
}

export function CharCount({ value, limit }: { value: string; limit: number }) {
  const used = charLength(value);
  const tone = used > limit ? " over" : used > limit * 0.85 ? " near" : "";
  return (
    <span className={`ntf-count${tone}`} title={used > limit ? "Phones will cut this off" : undefined}>
      {used}/{limit}
    </span>
  );
}

/** App users as picker options, via the same lookup the record forms use. */
export function useUserOptions() {
  const [options, setOptions] = useState<SelectOption[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  useEffect(() => {
    let alive = true;
    fetch("/api/admin/lookups?keys=users", { cache: "no-store" })
      .then((r) => r.json())
      .then((j: { ok?: boolean; data?: Record<string, LookupOption[]> }) => {
        if (!alive) return;
        if (j?.ok && j.data?.users) {
          setOptions(fromLookup(j.data.users));
          setState("ready");
        } else setState("failed");
      })
      .catch(() => { if (alive) setState("failed"); });
    return () => { alive = false; };
  }, []);
  return { options, state };
}

type PhoneProps = {
  title: string;
  body: string;
  /** Small caption above the phone, e.g. "বাংলা". */
  caption?: string;
  cta?: string;
  showPush?: boolean;
  showInApp?: boolean;
  lang?: "bn" | "en";
};

/**
 * A lock-screen push and the in-app inbox row, drawn at phone width so line
 * breaks and truncation match what a farmer sees closely enough to judge.
 */
export function PhonePreview({ title, body, caption, cta, showPush = true, showInApp = true, lang = "en" }: PhoneProps) {
  const t = title.trim() || (lang === "bn" ? "শিরোনাম" : "Title");
  const b = body.trim() || (lang === "bn" ? "বার্তার লেখা এখানে দেখাবে" : "Message text shows here");
  return (
    <figure className="phone">
      {caption ? <figcaption className="phone-caption">{caption}</figcaption> : null}
      <div className="phone-frame" lang={lang}>
        <div className="phone-notch" />
        <div className="phone-time">9:41</div>
        {showPush ? (
          <div className="phone-push">
            <div className="phone-push-head">
              <span className="phone-app-icon" aria-hidden="true" />
              <span>Shathi Sheba</span>
              <span className="phone-push-when">{lang === "bn" ? "এখন" : "now"}</span>
            </div>
            <strong className="phone-push-title">{t}</strong>
            <p className="phone-push-body">{b}</p>
          </div>
        ) : (
          <div className="phone-off">{lang === "bn" ? "পুশ বন্ধ" : "Push off"}</div>
        )}
        {showInApp ? (
          <div className="phone-inbox">
            <div className="phone-inbox-bar"><Bell size={12} /> {lang === "bn" ? "নোটিফিকেশন" : "Notifications"}</div>
            <div className="phone-inbox-row">
              <span className="phone-inbox-dot" />
              <div>
                <strong>{t}</strong>
                <p>{b}</p>
                {cta ? <span className="phone-cta">{cta}</span> : null}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </figure>
  );
}
