import type { Metadata } from "next";
import { PublicShell } from "@/components/public/PublicShell";
import { Rich } from "@/components/public/Rich";
import { getPublicLoanDisclosure, type PublicLoanDisclosure } from "@/lib/finance/disclosure";
import { CONTACT_EMAIL, formatNumber, resolveLang, type Lang } from "@/lib/public-pages";

export const metadata: Metadata = {
  title: "Loan terms and costs · Shathi Sheba",
  description: "Repayment periods, APR range, fees and a representative example for loans offered through Shathi Sheba by partner lenders."
};

// The figures are read live from the same function that serves
// GET /api/v1/public/loan-disclosure (lib/finance/disclosure.ts), which runs
// every offered product, tenure and repayment mode through the quoting engine.

type Rep = NonNullable<PublicLoanDisclosure["representative"]>;

const MODE: Record<Lang, Record<string, string>> = {
  en: { weekly: "weekly", monthly: "monthly", one_time: "single" },
  bn: { weekly: "সাপ্তাহিক", monthly: "মাসিক", one_time: "এককালীন" }
};

function money(n: number, lang: Lang) {
  return `৳${formatNumber(n, lang, 2)}`;
}

// APRs always carry two decimals (29.69%); a headline flat rate reads better
// without trailing zeros (13%).
function pct(n: number, lang: Lang) {
  return `${formatNumber(n, lang, 2)}%`;
}

function rate(n: number, lang: Lang) {
  return `${formatNumber(n, lang)}%`;
}

function months(n: number, lang: Lang) {
  return lang === "bn" ? `${formatNumber(n, lang)} মাস` : `${n} month${n === 1 ? "" : "s"}`;
}

function instalments(rep: Rep, lang: Lang) {
  if (rep.repayment_mode === "one_time") {
    return lang === "bn"
      ? `মেয়াদ শেষে একবারে ${money(rep.total_payable, lang)}`
      : `One payment of ${money(rep.total_payable, lang)} at the end`;
  }
  const last = Math.round((rep.total_payable - rep.emi_amount * (rep.installment_count - 1)) * 100) / 100;
  const tail = Math.abs(last - rep.emi_amount) >= 0.005
    ? lang === "bn" ? ` (শেষ কিস্তি ${money(last, lang)})` : ` (the last one ${money(last, lang)})`
    : "";
  return lang === "bn"
    ? `${formatNumber(rep.installment_count, lang)}টি ${MODE.bn[rep.repayment_mode]} কিস্তি, প্রতিটি ${money(rep.emi_amount, lang)}${tail}`
    : `${rep.installment_count} ${MODE.en[rep.repayment_mode]} instalments of ${money(rep.emi_amount, lang)}${tail}`;
}

export default async function LoanDisclosurePage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const lang = await resolveLang(searchParams);
  const t = (en: string, bn: string) => (lang === "bn" ? bn : en);
  const d = await getPublicLoanDisclosure();
  const rep = d.representative;
  const anyFee = d.fees.processing_fee_pct_max > 0 || d.fees.processing_fee_flat_max > 0;
  const aprMin = d.apr_min_pct;
  const aprMax = d.apr_max_pct;
  const tenureMin = d.tenure_min_months;
  const tenureMax = d.tenure_max_months;

  return (
    <PublicShell
      lang={lang}
      path="/loan-disclosure"
      title={t("Loan terms and costs", "ঋণের শর্ত ও খরচ")}
      subtitle={t("What a loan through Shathi Sheba costs, before you apply.", "আবেদনের আগেই জেনে নিন, শাথী সেবার মাধ্যমে ঋণের খরচ কত।")}
    >
      <section className="pub-card" id="about">
        <h2>{t("About these loans", "এই ঋণ সম্পর্কে")}</h2>
        <p>
          {t(
            "Shathi Sheba does not lend money. Loans are provided by our partner lenders — banks, microfinance institutions and other financial institutions. Shathi Sheba helps you check your readiness and prepare your application, and with your consent sends it to a lender.",
            "শাথী সেবা নিজে ঋণ দেয় না। ঋণ দেয় আমাদের পার্টনার ঋণদাতা — ব্যাংক, ক্ষুদ্রঋণ প্রতিষ্ঠান ও অন্যান্য আর্থিক প্রতিষ্ঠান। শাথী সেবা আপনার প্রস্তুতি যাচাই ও আবেদন তৈরিতে সাহায্য করে, এবং আপনার সম্মতিতে তা ঋণদাতার কাছে পাঠায়।"
          )}
        </p>
        <p>
          <Rich
            text={t(
              "**Approval is not guaranteed.** The lender decides after reviewing your application. The figures below are the terms currently offered in the app; your final terms are confirmed in your loan agreement before you accept.",
              "**ঋণ অনুমোদনের নিশ্চয়তা নেই।** আবেদন পর্যালোচনা করে ঋণদাতা সিদ্ধান্ত নেয়। নিচের হিসাবগুলো অ্যাপে বর্তমানে দেওয়া শর্ত; আপনার চূড়ান্ত শর্ত গ্রহণের আগে ঋণচুক্তিতে নিশ্চিত করা হয়।"
            )}
          />
        </p>
      </section>

      {!rep || aprMin === null || aprMax === null || tenureMin === null || tenureMax === null || !d.products.length ? (
        <section className="pub-card">
          <h2>{t("No loans are offered at the moment", "এই মুহূর্তে কোনো ঋণ দেওয়া হচ্ছে না")}</h2>
          <p>{t("Please check again later.", "পরে আবার দেখুন।")}</p>
        </section>
      ) : (
        <>
          <section className="pub-card" id="at-a-glance">
            <h2>{t("At a glance", "এক নজরে")}</h2>
            <div className="pub-stats">
              <div className="pub-stat">
                <span className="pub-stat-label">{t("Repayment period", "পরিশোধের মেয়াদ")}</span>
                <span className="pub-stat-value">
                  {lang === "bn"
                    ? `${formatNumber(tenureMin, lang)} – ${formatNumber(tenureMax, lang)} মাস`
                    : `${tenureMin} – ${tenureMax} months`}
                </span>
              </div>
              <div className="pub-stat">
                <span className="pub-stat-label">{t("APR — yearly cost, interest and fees", "বার্ষিক খরচের হার (APR) — সুদ ও ফি মিলিয়ে")}</span>
                <span className="pub-stat-value">
                  {pct(aprMin, lang)} – {pct(aprMax, lang)}
                </span>
              </div>
              <div className="pub-stat">
                <span className="pub-stat-label">{t("Maximum APR", "সর্বোচ্চ বার্ষিক খরচের হার (APR)")}</span>
                <span className="pub-stat-value">{pct(aprMax, lang)}</span>
              </div>
              <div className="pub-stat">
                <span className="pub-stat-label">{t("Processing fee", "প্রসেসিং ফি")}</span>
                <span className="pub-stat-value">{anyFee ? t("See below", "নিচে দেখুন") : t("None", "নেই")}</span>
              </div>
            </div>
            <p>
              {t(
                `No loan has to be repaid in full within 60 days: the shortest repayment period is ${months(tenureMin, lang)}. Depending on the product, you can repay weekly, monthly, or in one payment at the end.`,
                `কোনো ঋণ ৬০ দিনের মধ্যে পুরোপুরি পরিশোধ করতে হয় না: সবচেয়ে কম মেয়াদ ${months(tenureMin, lang)}। পণ্যভেদে সাপ্তাহিক, মাসিক বা মেয়াদ শেষে এককালীন পরিশোধ করা যায়।`
              )}
            </p>
          </section>

          <section className="pub-card" id="example">
            <h2>{t("Representative example", "একটি নমুনা হিসাব")}</h2>
            <p>
              {lang === "bn"
                ? `${rep.product_name_bn || rep.product_name_en}-এ বছরে ${rate(rep.nominal_rate_pct, lang)} ফ্ল্যাট হারে ${money(rep.principal, lang)} নিয়ে ${months(rep.tenure_months, lang)}ে পরিশোধ করলে:`
                : `Borrowing ${money(rep.principal, lang)} as a ${rep.product_name_en} at a flat rate of ${rate(rep.nominal_rate_pct, lang)} a year, repaid over ${months(rep.tenure_months, lang)}:`}
            </p>
            <ul className="pub-rows">
              <li><span>{t("Amount borrowed", "ঋণের পরিমাণ")}</span><span>{money(rep.principal, lang)}</span></li>
              <li><span>{t("Repayments", "পরিশোধ")}</span><span>{instalments(rep, lang)}</span></li>
              <li><span>{t("Total interest", "মোট সুদ")}</span><span>{money(rep.total_interest, lang)}</span></li>
              <li><span>{t("Processing fee", "প্রসেসিং ফি")}</span><span>{money(rep.processing_fee, lang)}</span></li>
              <li><span>{t("Total amount to repay", "মোট পরিশোধযোগ্য")}</span><span>{money(rep.total_payable, lang)}</span></li>
              <li><span>{t("APR", "বার্ষিক খরচের হার (APR)")}</span><span>{pct(rep.apr_pct, lang)}</span></li>
            </ul>
          </section>

          <section className="pub-card" id="apr">
            <h2>{t("What APR means", "APR মানে কী")}</h2>
            <p>
              {t(
                "APR (annual percentage rate) is the total yearly cost of a loan — the interest plus any fees — written as a percentage, so that different loans can be compared.",
                "বার্ষিক খরচের হার (APR) হলো একটি ঋণের মোট বার্ষিক খরচ — সুদ ও যেকোনো ফি মিলিয়ে — শতাংশে লেখা, যাতে বিভিন্ন ঋণ তুলনা করা যায়।"
              )}
            </p>
            <p>
              {t(
                "On these loans, interest is charged at a flat rate: on the full amount you borrowed, for the whole repayment period. Because you repay in instalments, you owe less as time goes on, so the APR is close to twice the flat rate. If you repay in a single payment at the end, the APR equals the flat rate.",
                "এই ঋণগুলোতে সুদ ধরা হয় ফ্ল্যাট হারে: পুরো মেয়াদজুড়ে, নেওয়া পুরো টাকার ওপর। কিন্তু আপনি কিস্তিতে পরিশোধ করেন বলে সময়ের সাথে বকেয়া কমতে থাকে, তাই APR ফ্ল্যাট হারের প্রায় দ্বিগুণ হয়। মেয়াদ শেষে এককালীন পরিশোধ করলে APR ফ্ল্যাট হারের সমান।"
              )}
            </p>
          </section>

          <section className="pub-card" id="products">
            <h2>{t("Loan products", "ঋণের ধরন")}</h2>
            <div className="pub-products">
              {d.products.map((p) => (
                <div className="pub-product" key={p.code}>
                  <h3>{lang === "bn" ? p.name_bn || p.name_en : p.name_en}</h3>
                  <ul className="pub-rows">
                    <li><span>{t("Flat interest rate", "ফ্ল্যাট সুদের হার")}</span><span>{t(`${rate(p.nominal_rate_pct, lang)} a year`, `বছরে ${rate(p.nominal_rate_pct, lang)}`)}</span></li>
                    <li><span>{t("APR, up to", "সর্বোচ্চ APR")}</span><span>{pct(p.apr_max_pct, lang)}</span></li>
                    <li>
                      <span>{t("Repayment period", "পরিশোধের মেয়াদ")}</span>
                      <span>
                        {lang === "bn"
                          ? `${formatNumber(p.tenure_min_months, lang)} – ${formatNumber(p.tenure_max_months, lang)} মাস`
                          : `${p.tenure_min_months} – ${p.tenure_max_months} months`}
                      </span>
                    </li>
                  </ul>
                </div>
              ))}
            </div>
          </section>

          <section className="pub-card" id="fees">
            <h2>{t("Fees and repaying late", "ফি ও দেরিতে পরিশোধ")}</h2>
            <p>{lang === "bn" ? d.fees_note_bn : d.fees_note}</p>
            <p>
              {t(
                "Missing a repayment can make it harder to borrow again, and the lender may take the steps set out in your loan agreement. If you are having trouble repaying, talk to your field officer or contact us early.",
                "কিস্তি দিতে না পারলে ভবিষ্যতে ঋণ পাওয়া কঠিন হতে পারে, এবং ঋণদাতা ঋণচুক্তিতে লেখা ব্যবস্থা নিতে পারে। পরিশোধে সমস্যা হলে আগেভাগে আপনার মাঠ কর্মকর্তার সাথে কথা বলুন বা আমাদের জানান।"
              )}
            </p>
          </section>
        </>
      )}

      <section className="pub-card" id="contact">
        <h2>{t("Questions", "প্রশ্ন")}</h2>
        <p>
          <Rich
            text={t(
              `Email [${CONTACT_EMAIL}](mailto:${CONTACT_EMAIL}). See also our [Privacy policy](/privacy) and [Terms of use](/terms).`,
              `ইমেইল করুন: [${CONTACT_EMAIL}](mailto:${CONTACT_EMAIL})। আরও দেখুন আমাদের [গোপনীয়তা নীতি](/privacy) ও [ব্যবহারের শর্তাবলি](/terms)।`
            )}
          />
        </p>
      </section>
    </PublicShell>
  );
}
