"use client";

import { useEffect, useState, type FormEvent } from "react";

type Lang = "bn" | "en";
type Step = "phone" | "code" | "done";

const API = "/api/v1/public/account-deletion";

// Bangla keyboards type Bangla numerals; the server expects ASCII digits.
const toAsciiDigits = (s: string) => s.replace(/[০-৯]/g, (d) => String("০১২৩৪৫৬৭৮৯".indexOf(d)));
const cleanPhone = (s: string) => toAsciiDigits(s).replace(/[\s()-]/g, "");
const bnDigits = (s: string) => s.replace(/[0-9]/g, (d) => "০১২৩৪৫৬৭৮৯"[Number(d)]);

const TEXT = {
  en: {
    phoneLabel: "Mobile number",
    phoneHint: "The number you use to sign in to Shathi Sheba, for example 01XXXXXXXXX.",
    sendCode: "Send code",
    sending: "Sending…",
    codeSent: (phone: string) =>
      `If ${phone} has a Shathi Sheba account, we have sent a code to it by SMS. The code is valid for 5 minutes.`,
    codeLabel: "Code from the SMS",
    agree: "I understand that my account will be deleted permanently, and that this cannot be undone.",
    delete: "Delete my account",
    deleting: "Deleting…",
    resend: "Send a new code",
    resendIn: (s: number) => `Send a new code in ${s}s`,
    otherNumber: "Use a different number",
    doneTitle: "Your account has been deleted.",
    done: "Your personal information has been erased and every sign-in on your phone has ended. Records we are required to keep — orders, payments and loans — are kept for 5 years without your name, phone number or other details, and then deleted.",
    badPhone: "Enter your mobile number, for example 01XXXXXXXXX.",
    badCode: "Enter the code from the SMS.",
    mustAgree: "Tick the box to confirm that you want to delete your account.",
    network: "Could not reach Shathi Sheba. Check your internet connection and try again.",
    generic: "Something went wrong. Please try again.",
    wait: (s: number) =>
      s >= 120 ? `Too many attempts. Please try again in about ${Math.ceil(s / 60)} minutes.` : `Please wait ${s} seconds and try again.`,
    errors: {} as Record<string, string>
  },
  bn: {
    phoneLabel: "মোবাইল নম্বর",
    phoneHint: "যে নম্বর দিয়ে শাথী সেবায় লগইন করেন, যেমন ০১XXXXXXXXX।",
    sendCode: "কোড পাঠান",
    sending: "পাঠানো হচ্ছে…",
    codeSent: (phone: string) =>
      `${phone} নম্বরে শাথী সেবা অ্যাকাউন্ট থাকলে আমরা এসএমএসে একটি কোড পাঠিয়েছি। কোডটি ৫ মিনিট কার্যকর থাকবে।`,
    codeLabel: "এসএমএসে পাওয়া কোড",
    agree: "আমি বুঝেছি যে আমার অ্যাকাউন্ট স্থায়ীভাবে মুছে যাবে এবং তা আর ফেরানো যাবে না।",
    delete: "আমার অ্যাকাউন্ট মুছে ফেলুন",
    deleting: "মুছে ফেলা হচ্ছে…",
    resend: "নতুন কোড পাঠান",
    resendIn: (s: number) => `${bnDigits(String(s))} সেকেন্ড পর নতুন কোড পাঠানো যাবে`,
    otherNumber: "অন্য নম্বর ব্যবহার করুন",
    doneTitle: "আপনার অ্যাকাউন্ট মুছে ফেলা হয়েছে।",
    done: "আপনার ব্যক্তিগত তথ্য মুছে ফেলা হয়েছে এবং ফোনের সব লগইন বন্ধ হয়ে গেছে। যে রেকর্ড রাখা বাধ্যতামূলক — অর্ডার, পেমেন্ট ও ঋণ — তা আপনার নাম, মোবাইল নম্বর ও অন্যান্য তথ্য ছাড়া ৫ বছর রাখা হবে, তারপর মুছে ফেলা হবে।",
    badPhone: "আপনার মোবাইল নম্বর দিন, যেমন ০১XXXXXXXXX।",
    badCode: "এসএমএসে পাওয়া কোডটি দিন।",
    mustAgree: "অ্যাকাউন্ট মুছে ফেলতে চান নিশ্চিত করতে বাক্সে টিক দিন।",
    network: "শাথী সেবার সাথে সংযোগ করা যায়নি। ইন্টারনেট সংযোগ দেখে আবার চেষ্টা করুন।",
    generic: "কিছু একটা ভুল হয়েছে। আবার চেষ্টা করুন।",
    wait: (s: number) =>
      s >= 120
        ? `অনেকবার চেষ্টা করা হয়েছে। প্রায় ${bnDigits(String(Math.ceil(s / 60)))} মিনিট পর আবার চেষ্টা করুন।`
        : `${bnDigits(String(s))} সেকেন্ড অপেক্ষা করে আবার চেষ্টা করুন।`,
    // The server writes its refusals in English; these are the ones this form can meet.
    errors: {
      "A valid phone number is required.": "সঠিক মোবাইল নম্বর দিন।",
      "Enter the code we sent you.": "এসএমএসে পাওয়া কোডটি দিন।",
      "Incorrect code.": "কোডটি সঠিক নয়।",
      "Code expired or not found. Please request a new code.": "কোডের মেয়াদ শেষ হয়ে গেছে বা কোড পাওয়া যায়নি। নতুন কোড চান।",
      "Too many attempts. Please request a new code.": "অনেকবার ভুল কোড দেওয়া হয়েছে। নতুন কোড চান।"
    } as Record<string, string>
  }
};

export function DeleteAccountForm({ lang }: { lang: Lang }) {
  const t = TEXT[lang];
  const [step, setStep] = useState<Step>("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wait, setWait] = useState(0);

  useEffect(() => {
    if (wait <= 0) return;
    const timer = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(timer);
  }, [wait]);

  async function post(path: string, body: Record<string, string>) {
    const res = await fetch(`${API}/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string; retry_after?: number };
    return { res, json };
  }

  function refusal(status: number, json: { message?: string; retry_after?: number }): string {
    if (status === 429) {
      const seconds = Math.max(1, Number(json.retry_after ?? 60));
      setWait(seconds);
      return lang === "en" && json.message ? json.message : t.wait(seconds);
    }
    const message = String(json.message ?? "");
    if (lang === "bn") return t.errors[message] ?? t.generic;
    return message || t.generic;
  }

  async function sendCode() {
    setError(null);
    const number = cleanPhone(phone);
    if (!/^\+?[0-9]{10,14}$/.test(number)) {
      setError(t.badPhone);
      return;
    }
    setBusy(true);
    try {
      const { res, json } = await post("request-code", { phone: number });
      if (!res.ok || !json.ok) {
        setError(refusal(res.status, json));
        return;
      }
      setCode("");
      setStep("code");
      setWait(60);
    } catch {
      setError(t.network);
    } finally {
      setBusy(false);
    }
  }

  async function confirmDeletion(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const typed = toAsciiDigits(code).trim();
    if (!/^\d{4,8}$/.test(typed)) {
      setError(t.badCode);
      return;
    }
    if (!agree) {
      setError(t.mustAgree);
      return;
    }
    setBusy(true);
    try {
      const { res, json } = await post("confirm", { phone: cleanPhone(phone), code: typed });
      if (!res.ok || !json.ok) {
        setError(refusal(res.status, json));
        return;
      }
      setStep("done");
    } catch {
      setError(t.network);
    } finally {
      setBusy(false);
    }
  }

  if (step === "done") {
    return (
      <div className="pub-note is-ok" role="status">
        <p><strong>{t.doneTitle}</strong></p>
        <p>{t.done}</p>
      </div>
    );
  }

  const shownPhone = lang === "bn" ? bnDigits(cleanPhone(phone)) : cleanPhone(phone);

  return (
    <div>
      {error ? <p className="pub-note is-bad" role="alert">{error}</p> : null}

      {step === "phone" ? (
        <form
          className="pub-form"
          onSubmit={(e) => {
            e.preventDefault();
            void sendCode();
          }}
          noValidate
        >
          <div className="pub-field">
            <label htmlFor="delete-phone">{t.phoneLabel}</label>
            <input
              id="delete-phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              maxLength={16}
              aria-describedby="delete-phone-hint"
              required
            />
            <span id="delete-phone-hint" className="pub-field-hint">{t.phoneHint}</span>
          </div>
          <div className="pub-actions">
            {/* Not held by a countdown: the resend interval is per number, and
                this step may be for a different one. */}
            <button type="submit" className="pub-btn" disabled={busy}>
              {busy ? t.sending : t.sendCode}
            </button>
          </div>
        </form>
      ) : (
        <form className="pub-form" onSubmit={confirmDeletion} noValidate>
          <p className="pub-note" role="status">{t.codeSent(shownPhone)}</p>
          <div className="pub-field">
            <label htmlFor="delete-code">{t.codeLabel}</label>
            <input
              id="delete-code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              maxLength={8}
              required
            />
          </div>
          <label className="pub-check">
            <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
            <span>{t.agree}</span>
          </label>
          <div className="pub-actions">
            <button type="submit" className="pub-btn is-danger" disabled={busy}>
              {busy ? t.deleting : t.delete}
            </button>
          </div>
          <div className="pub-actions">
            <button type="button" className="pub-link-btn" disabled={busy || wait > 0} onClick={() => void sendCode()}>
              {wait > 0 ? t.resendIn(wait) : t.resend}
            </button>
            <button
              type="button"
              className="pub-link-btn"
              disabled={busy}
              onClick={() => {
                setStep("phone");
                setError(null);
                setAgree(false);
              }}
            >
              {t.otherNumber}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
