import type { ReactNode } from "react";
import { CONTACT_EMAIL, LAST_UPDATED, LOGO_URL, OPERATOR, type Lang } from "@/lib/public-pages";

/**
 * The frame of every public page: the wordmark and a language switch, the
 * maroon title band, the content, and a footer that links the four pages
 * together and names who runs the service. Deliberately not the console's
 * AdminShell — these pages are for farmers and for Google Play's reviewers.
 */
export function PublicShell({
  lang,
  path,
  title,
  subtitle,
  children
}: {
  lang: Lang;
  path: string;
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  const t = (en: string, bn: string) => (lang === "bn" ? bn : en);
  const href = (p: string) => `${p}?lang=${lang}`;
  return (
    <div className="pub" lang={lang}>
      <header className="pub-header">
        <div className="pub-header-inner">
          <span className="pub-brand">
            {/* A plain <img>: the logo is a small fixed asset on our own bucket, and
                next/image would need a remote-image allowance for one file. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="pub-logo" src={LOGO_URL} alt={t("Shathi Sheba", "শাথী সেবা")} width={129} height={40} />
          </span>
          <nav className="pub-lang" aria-label={t("Language", "ভাষা")}>
            <a href={`${path}?lang=bn`} hrefLang="bn" lang="bn" aria-current={lang === "bn" ? "true" : undefined}>
              বাংলা
            </a>
            <a href={`${path}?lang=en`} hrefLang="en" lang="en" aria-current={lang === "en" ? "true" : undefined}>
              English
            </a>
          </nav>
        </div>
      </header>

      <section className="pub-hero">
        <div className="pub-hero-inner">
          <h1>{title}</h1>
          {subtitle ? <p>{subtitle}</p> : null}
          <p className="pub-updated">
            {t("Last updated", "সর্বশেষ হালনাগাদ")}: {LAST_UPDATED[lang]}
          </p>
        </div>
      </section>

      <main className="pub-main">{children}</main>

      <footer className="pub-footer">
        <div className="pub-footer-inner">
          <nav aria-label={t("Policies", "নীতিমালা")}>
            <a href={href("/privacy")}>{t("Privacy policy", "গোপনীয়তা নীতি")}</a>
            <a href={href("/terms")}>{t("Terms of use", "ব্যবহারের শর্তাবলি")}</a>
            <a href={href("/delete-account")}>{t("Delete your account", "অ্যাকাউন্ট মুছে ফেলুন")}</a>
            <a href={href("/loan-disclosure")}>{t("Loan terms and costs", "ঋণের শর্ত ও খরচ")}</a>
          </nav>
          <p>
            {t(
              `Shathi Sheba is operated by ${OPERATOR.en}, Bangladesh.`,
              `শাথী সেবা পরিচালনা করে ${OPERATOR.bn}, বাংলাদেশ।`
            )}
          </p>
          <p>
            {t("Contact", "যোগাযোগ")}: <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
          </p>
        </div>
      </footer>
    </div>
  );
}
