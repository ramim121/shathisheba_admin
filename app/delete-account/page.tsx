import type { Metadata } from "next";
import { PublicShell } from "@/components/public/PublicShell";
import { DeleteAccountForm } from "@/components/public/DeleteAccountForm";
import { Rich, Sections, type Section } from "@/components/public/Rich";
import { CONTACT_EMAIL, resolveLang, type Lang } from "@/lib/public-pages";

export const metadata: Metadata = {
  title: "Delete your account · Shathi Sheba",
  description: "Delete your Shathi Sheba account in the app or on this page. What is erased straight away, and what is kept for 5 years without your identity."
};

// What this page promises is what lib/account-deletion.ts does. If one
// changes, change the other.

const MAIL = `[${CONTACT_EMAIL}](mailto:${CONTACT_EMAIL})`;

type Content = {
  title: string;
  subtitle: string;
  inApp: Section;
  web: { title: string; intro: string };
  after: Section[];
};

const CONTENT: Record<Lang, Content> = {
  en: {
    title: "Delete your account",
    subtitle: "You can delete your Shathi Sheba account at any time, in the app or on this page.",
    inApp: {
      id: "in-the-app",
      title: "Delete it in the app",
      body: [
        {
          steps: [
            "Open Shathi Sheba and sign in.",
            "Open the **Menu**.",
            "Under **Privacy & account**, tap **Delete my account**, type your mobile number to confirm, then tap the red button."
          ]
        }
      ]
    },
    web: {
      title: "Or delete it here",
      intro: "Enter the mobile number you sign in with. We will send a code to that number by SMS; enter it below to confirm."
    },
    after: [
      {
        id: "erased",
        title: "What is erased straight away",
        body: [
          {
            list: [
              "Your profile: name, photo, gender, date of birth, address and location.",
              "Your phone number, and every sign-in session and device registered for notifications.",
              "Your NID number and identity (KYC) documents, and the photos and documents you uploaded.",
              "Your bank and mobile banking details, and your farm information.",
              "Your community posts and comments.",
              "Your Shathi Apa conversations: questions, voice transcripts and photos.",
              "Your loan readiness self-checks, learning progress, interests and notifications."
            ]
          }
        ]
      },
      {
        id: "kept",
        title: "What is kept for 5 years, without your identity",
        body: [
          "A business must keep some records for accounting, tax and lending rules: **orders, sales and payments, loan applications, loan accounts and repayments, and partner project records**.",
          "We keep those for **5 years** after your account is deleted, with your name, phone number, NID, addresses, photos, documents and notes removed, so they no longer identify you. Then they are deleted."
        ]
      },
      {
        id: "before",
        title: "Before you delete",
        body: [
          {
            list: [
              "Deleting cannot be undone.",
              "A loan you have already received is not cancelled — you still owe it to the lender under your agreement.",
              "Loan applications still in progress are withdrawn, and sale listings that are still open are cancelled. Sales and orders already under way are settled by our staff.",
              "Lenders that already received your application keep their own records.",
              "You can sign up again later with the same number. You will start with a new, empty account."
            ]
          }
        ]
      },
      {
        id: "help",
        title: "Need help?",
        body: [`If you cannot receive the SMS code, or have any question about deleting your account, email ${MAIL}.`]
      }
    ]
  },
  bn: {
    title: "আপনার অ্যাকাউন্ট মুছে ফেলুন",
    subtitle: "আপনি যেকোনো সময় অ্যাপ থেকে বা এই পাতা থেকে আপনার শাথী সেবা অ্যাকাউন্ট মুছে ফেলতে পারেন।",
    inApp: {
      id: "in-the-app",
      title: "অ্যাপ থেকে মুছে ফেলুন",
      body: [
        {
          steps: [
            "শাথী সেবা খুলে লগইন করুন।",
            "**মেনু** খুলুন।",
            "**গোপনীয়তা ও অ্যাকাউন্ট** অংশে **অ্যাকাউন্ট মুছে ফেলুন** চাপুন, নিশ্চিত করতে আপনার মোবাইল নম্বর লিখুন, তারপর লাল বোতাম চাপুন।"
          ]
        }
      ]
    },
    web: {
      title: "অথবা এখানে মুছে ফেলুন",
      intro: "যে মোবাইল নম্বর দিয়ে লগইন করেন তা দিন। আমরা সেই নম্বরে এসএমএসে একটি কোড পাঠাব; নিশ্চিত করতে নিচে কোডটি দিন।"
    },
    after: [
      {
        id: "erased",
        title: "যা সঙ্গে সঙ্গে মুছে ফেলা হয়",
        body: [
          {
            list: [
              "আপনার প্রোফাইল: নাম, ছবি, লিঙ্গ, জন্মতারিখ, ঠিকানা ও অবস্থান।",
              "আপনার মোবাইল নম্বর, এবং সব লগইন সেশন ও নোটিফিকেশনের জন্য নিবন্ধিত ডিভাইস।",
              "আপনার এনআইডি নম্বর ও পরিচয় যাচাইয়ের (কেওয়াইসি) কাগজপত্র, এবং আপনার আপলোড করা ছবি ও কাগজপত্র।",
              "আপনার ব্যাংক ও মোবাইল ব্যাংকিংয়ের তথ্য, এবং খামারের তথ্য।",
              "আপনার কমিউনিটি পোস্ট ও মন্তব্য।",
              "শাথী আপার সাথে আপনার কথোপকথন: প্রশ্ন, ভয়েসের লিখিত রূপ ও ছবি।",
              "আপনার ঋণ-প্রস্তুতির স্ব-মূল্যায়ন, শিখনের অগ্রগতি, আগ্রহের বিষয় ও নোটিফিকেশন।"
            ]
          }
        ]
      },
      {
        id: "kept",
        title: "যা আপনার পরিচয় ছাড়া ৫ বছর রাখা হয়",
        body: [
          "হিসাবরক্ষণ, কর ও ঋণ-সংক্রান্ত নিয়ম মেনে একটি প্রতিষ্ঠানকে কিছু রেকর্ড রাখতে হয়: **অর্ডার, বিক্রি ও পেমেন্ট, ঋণের আবেদন, ঋণ হিসাব ও কিস্তি পরিশোধ, এবং পার্টনার প্রকল্পের রেকর্ড**।",
          "অ্যাকাউন্ট মুছে ফেলার পর সেগুলো **৫ বছর** রাখা হয় — আপনার নাম, মোবাইল নম্বর, এনআইডি, ঠিকানা, ছবি, কাগজপত্র ও নোট সরিয়ে, যাতে তা থেকে আর আপনাকে চেনা না যায়। তারপর সেগুলোও মুছে ফেলা হয়।"
        ]
      },
      {
        id: "before",
        title: "মুছে ফেলার আগে জেনে নিন",
        body: [
          {
            list: [
              "মুছে ফেলা অ্যাকাউন্ট আর ফেরানো যায় না।",
              "ইতিমধ্যে নেওয়া ঋণ বাতিল হয় না — চুক্তি অনুযায়ী তা ঋণদাতাকে পরিশোধ করতে হবে।",
              "চলমান ঋণের আবেদন প্রত্যাহার হয়ে যায়, এবং খোলা থাকা বিক্রির তালিকা বাতিল হয়। ইতিমধ্যে চলমান বিক্রি ও অর্ডার আমাদের কর্মীরা নিষ্পত্তি করেন।",
              "যে ঋণদাতারা আগেই আপনার আবেদন পেয়েছে, তারা নিজেদের রেকর্ড রাখে।",
              "পরে একই নম্বর দিয়ে আবার নিবন্ধন করতে পারবেন; তখন একটি নতুন, খালি অ্যাকাউন্ট দিয়ে শুরু হবে।"
            ]
          }
        ]
      },
      {
        id: "help",
        title: "সাহায্য দরকার?",
        body: [`এসএমএসের কোড না পেলে, বা অ্যাকাউন্ট মুছে ফেলা নিয়ে কোনো প্রশ্ন থাকলে ইমেইল করুন: ${MAIL}।`]
      }
    ]
  }
};

export default async function DeleteAccountPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const lang = await resolveLang(searchParams);
  const c = CONTENT[lang];
  return (
    <PublicShell lang={lang} path="/delete-account" title={c.title} subtitle={c.subtitle}>
      <Sections sections={[c.inApp]} />
      <section id="on-this-page" className="pub-card">
        <h2>{c.web.title}</h2>
        <p><Rich text={c.web.intro} /></p>
        <DeleteAccountForm lang={lang} />
      </section>
      <Sections sections={c.after} />
    </PublicShell>
  );
}
