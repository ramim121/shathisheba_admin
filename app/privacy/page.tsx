import type { Metadata } from "next";
import { PublicShell } from "@/components/public/PublicShell";
import { Contents, Sections, type Section } from "@/components/public/Rich";
import { CONTACT_EMAIL, resolveLang, type Lang } from "@/lib/public-pages";

export const metadata: Metadata = {
  title: "Privacy policy · Shathi Sheba",
  description: "How the Shathi Sheba app collects, uses, shares and protects your information, how long it is kept, and how to delete your account."
};

// Written against what the app and this server actually do — every data item,
// recipient and retention rule below is traceable to code (lib/endpoints/*,
// lib/notify.ts, lib/sms.ts, lib/s3.ts, lib/apa/*, lib/account-deletion.ts).
// Change the text when the behaviour changes, and bump LAST_UPDATED.

const MAIL = `[${CONTACT_EMAIL}](mailto:${CONTACT_EMAIL})`;

const CONTENT: Record<Lang, { title: string; subtitle: string; contents: string; sections: Section[] }> = {
  en: {
    title: "Privacy policy",
    subtitle: "How Shathi Sheba collects, uses, shares and protects your information.",
    contents: "Contents",
    sections: [
      {
        id: "who-we-are",
        title: "Who we are",
        body: [
          "Shathi Sheba is a mobile app for farmers and rural entrepreneurs in Bangladesh. It is operated by **Digigram Ventures Ltd.**, Bangladesh (“we”, “us”). This policy covers the Shathi Sheba Android app and the pages at shathisheba.digigramventures.com.",
          `Questions about this policy or about your information: ${MAIL}.`
        ]
      },
      {
        id: "what-we-collect",
        title: "Information we collect",
        body: [
          { sub: "Information you give us" },
          {
            list: [
              "**Phone number** — to create your account and to sign you in with a one-time code we send by SMS. We do not use passwords.",
              "**Profile** — your name, gender, date of birth, address (division, district, upazila, union and village) and, if you add one, a profile photo.",
              "**Identity verification (KYC)** — your National ID (NID) number, photos of your NID card and of yourself, and any other document you choose to upload, such as a trade licence or bank passbook.",
              "**Banking details** — bank name, branch, account name and number, and mobile banking (bKash, Nagad, Rocket, Upay) account number, if you add them.",
              "**Farm information** — land size, crops and livestock, the number of animals and ponds, and the farm’s address.",
              "**Buying and selling** — animals and produce you list for sale (description, weight, price, photos, contact details) and orders you place (products, delivery address).",
              "**Loans and readiness** — your answers to the loan readiness self-check; loan applications (amount, purpose, repayment period) and the consents you give; and information about your income, expenses, assets and existing loans that you or a field officer record for an application.",
              "**Partner projects** — your application to join a project, including your name as on your NID, your NID number, and banking and farm details.",
              "**Community** — posts, photos and comments you publish.",
              "**Shathi Apa** (the in-app assistant) — the questions you type, the voice recordings you make and the photos you send.",
              "**Learning** — lessons you complete, quiz scores and points."
            ]
          },
          { sub: "Information collected automatically" },
          {
            list: [
              "**Approximate location** — if you allow it, the app reads your phone’s approximate location, not precise GPS. We use it to set your area, to show local weather, and to check in a loan application from where you farm. The approximate coordinates are saved with your profile and with a loan application’s check-in.",
              "**Notification token** — a device token from Firebase Cloud Messaging, so that we can send you notifications.",
              "**Technical information** — the app version and phone platform, the IP address of requests (used for security and to stop abuse of sign-in codes), and error reports from the Shathi Apa screen."
            ]
          },
          "The app does not read your contacts, SMS messages, call log or the photos on your phone. It only receives the photos you choose to share."
        ]
      },
      {
        id: "how-we-use",
        title: "How we use your information",
        body: [
          {
            list: [
              "To create your account, sign you in and keep it secure.",
              "To provide what you ask for: buying and selling, partner projects, learning, the community, weather and the Shathi Apa assistant.",
              "To verify your identity and your farm, including visits by our field officers.",
              "To check your loan readiness, prepare your loan application and — only with your consent — share it with a lender.",
              "To send you notifications about your orders, listings, applications and account: in the app, by push notification, by SMS, and by email if you have given us an email address.",
              "To keep the community safe, moderate posts, and prevent fraud and misuse.",
              "To meet our legal, accounting and tax obligations."
            ]
          },
          "We do not sell your personal information, and we do not use it for advertising."
        ]
      },
      {
        id: "sharing",
        title: "Who we share it with",
        body: [
          {
            list: [
              "**Lenders** — banks, microfinance institutions and other partner lenders receive your application only when you apply for a loan and give your consent to share it. They receive what they need to assess it: your identity and KYC details, the application and our assessment. The lender decides whether to lend, and keeps its own records under its own privacy policy.",
              "**Behavioural assessment** — if you apply for a loan and agree to it, a short questionnaire is run by our assessment partner, mPowerU, under a pseudonymous ID.",
              "**Buyers and distributors** — to complete a sale or deliver an order, we share what is needed with the buyer or distributor involved, such as your name, area and delivery address.",
              "**Other users** — community posts and comments, and sale listings, are shown to other Shathi Sheba users together with your name and area.",
              "**Service providers** that process information for us: **Amazon Web Services** (our database, and the photos and documents you upload, in Amazon S3, in AWS’s Singapore region; email delivery through Amazon SES); **Google** (Firebase Cloud Messaging for notifications; and Google Gemini, which processes Shathi Apa questions, voice recordings and photos, helps write listing descriptions and understand listing photos, reads text aloud, and helps our staff moderate community posts and read uploaded documents); **BulkSMSBD** (SMS delivery, including sign-in codes); and **WeatherAPI.com** (the app sends your approximate location to WeatherAPI.com to fetch your local forecast).",
              "**Authorities** — when the law requires it, or to protect the safety and rights of our users and the public."
            ]
          }
        ]
      },
      {
        id: "storage",
        title: "Where your information is stored",
        body: [
          "Your information is stored with Amazon Web Services in its Singapore region: our database, and the photos and documents you upload. Identity documents are kept in private storage and are shown only to you and to authorised staff. Some of the service providers above may process information in other countries."
        ]
      },
      {
        id: "retention",
        title: "How long we keep it",
        body: [
          {
            list: [
              "While your account is open, we keep your information so that the app can work for you.",
              "Sign-in codes expire after 5 minutes.",
              "You can clear your Shathi Apa conversation history in the app at any time.",
              "When you delete your account, we erase your personal information straight away — see [Delete your account](/delete-account). We keep only the records a business is required to keep — orders, sales and payments, loan applications, loan accounts and repayments, and partner project records — for **5 years**, with your name, phone number, NID, addresses, photos, documents and other identifying details removed. After 5 years they are deleted.",
              "Lenders that received your application keep their own records under their own policies."
            ]
          }
        ]
      },
      {
        id: "your-rights",
        title: "Your choices and rights",
        body: [
          {
            list: [
              "**See and correct** your profile in the app. Some changes are checked by our staff before they take effect.",
              "**Withdraw** a loan application in the app before it is approved.",
              "**Location and notifications** can be turned off in your phone’s settings at any time. Local weather and the loan check-in need location.",
              "**Delete your account** in the app (Menu → Delete my account), or on the web at [shathisheba.digigramventures.com/delete-account](/delete-account) with your phone number and a code we send by SMS. If you cannot receive the code, email us.",
              `**Ask us** for a copy of your information, or anything else about your data, at ${MAIL}.`
            ]
          }
        ]
      },
      {
        id: "security",
        title: "Security",
        body: [
          "We use encrypted connections (HTTPS). Sign-in codes are short-lived and limited, identity documents are kept in private storage, and staff access is limited by role, with their actions logged. No system is perfectly secure, so please keep your phone and your codes to yourself."
        ]
      },
      {
        id: "children",
        title: "Children",
        body: [
          "Shathi Sheba is for adults aged 18 or over. We do not knowingly collect information from anyone under 18. If you believe a child has created an account, contact us and we will delete it."
        ]
      },
      {
        id: "changes",
        title: "Changes to this policy",
        body: [
          "We will post any change on this page and update the date at the top. If a change is significant, we will also tell you in the app."
        ]
      },
      {
        id: "contact",
        title: "Contact",
        body: [`Digigram Ventures Ltd., Bangladesh — ${MAIL}`]
      }
    ]
  },
  bn: {
    title: "গোপনীয়তা নীতি",
    subtitle: "শাথী সেবা কীভাবে আপনার তথ্য সংগ্রহ, ব্যবহার, শেয়ার ও সুরক্ষা করে।",
    contents: "সূচিপত্র",
    sections: [
      {
        id: "who-we-are",
        title: "আমরা কারা",
        body: [
          "শাথী সেবা বাংলাদেশের কৃষক ও গ্রামীণ উদ্যোক্তাদের জন্য একটি মোবাইল অ্যাপ। এটি পরিচালনা করে **ডিজিগ্রাম ভেঞ্চারস লিমিটেড**, বাংলাদেশ (“আমরা”)। এই নীতি শাথী সেবা অ্যান্ড্রয়েড অ্যাপ এবং shathisheba.digigramventures.com-এর পাতাগুলোর জন্য প্রযোজ্য।",
          `এই নীতি বা আপনার তথ্য নিয়ে কোনো প্রশ্ন থাকলে লিখুন: ${MAIL}।`
        ]
      },
      {
        id: "what-we-collect",
        title: "আমরা যে তথ্য সংগ্রহ করি",
        body: [
          { sub: "আপনি যে তথ্য দেন" },
          {
            list: [
              "**মোবাইল নম্বর** — অ্যাকাউন্ট খুলতে এবং এসএমএসে পাঠানো এককালীন কোড দিয়ে লগইন করাতে। আমরা পাসওয়ার্ড ব্যবহার করি না।",
              "**প্রোফাইল** — আপনার নাম, লিঙ্গ, জন্মতারিখ, ঠিকানা (বিভাগ, জেলা, উপজেলা, ইউনিয়ন ও গ্রাম) এবং আপনি দিলে প্রোফাইল ছবি।",
              "**পরিচয় যাচাই (কেওয়াইসি)** — আপনার জাতীয় পরিচয়পত্র (এনআইডি) নম্বর, এনআইডি কার্ড ও আপনার নিজের ছবি, এবং আপনি নিজে যে কাগজ আপলোড করেন, যেমন ট্রেড লাইসেন্স বা ব্যাংকের পাসবই।",
              "**ব্যাংকিং তথ্য** — আপনি দিলে ব্যাংকের নাম, শাখা, হিসাবের নাম ও নম্বর, এবং মোবাইল ব্যাংকিং (বিকাশ, নগদ, রকেট, উপায়) নম্বর।",
              "**খামারের তথ্য** — জমির পরিমাণ, ফসল ও পশুপালন, পশু ও পুকুরের সংখ্যা এবং খামারের ঠিকানা।",
              "**কেনাবেচা** — বিক্রির জন্য আপনার দেওয়া পশু বা পণ্যের তালিকা (বিবরণ, ওজন, দাম, ছবি, যোগাযোগের তথ্য) এবং আপনার অর্ডার (পণ্য, ডেলিভারির ঠিকানা)।",
              "**ঋণ ও প্রস্তুতি যাচাই** — ঋণ-প্রস্তুতির স্ব-মূল্যায়নে আপনার উত্তর; ঋণের আবেদন (পরিমাণ, উদ্দেশ্য, পরিশোধের মেয়াদ) ও আপনার দেওয়া সম্মতি; এবং আবেদনের জন্য আপনি বা মাঠ কর্মকর্তা যে আয়, খরচ, সম্পদ ও চলমান ঋণের তথ্য লেখেন।",
              "**পার্টনার প্রকল্প** — প্রকল্পে যোগ দেওয়ার আবেদন, যার মধ্যে এনআইডি অনুযায়ী নাম, এনআইডি নম্বর এবং ব্যাংকিং ও খামারের তথ্য থাকে।",
              "**কমিউনিটি** — আপনার প্রকাশ করা পোস্ট, ছবি ও মন্তব্য।",
              "**শাথী আপা** (অ্যাপের সহকারী) — আপনার লেখা প্রশ্ন, ভয়েস রেকর্ডিং ও পাঠানো ছবি।",
              "**শিখন** — শেষ করা পাঠ, কুইজের নম্বর ও পয়েন্ট।"
            ]
          },
          { sub: "যে তথ্য স্বয়ংক্রিয়ভাবে সংগ্রহ হয়" },
          {
            list: [
              "**আনুমানিক অবস্থান** — আপনি অনুমতি দিলে অ্যাপ আপনার ফোনের আনুমানিক অবস্থান পড়ে, নির্ভুল জিপিএস নয়। এটি দিয়ে আপনার এলাকা ঠিক করা হয়, স্থানীয় আবহাওয়া দেখানো হয়, এবং যেখানে চাষ করেন সেখান থেকে ঋণের আবেদনে চেক-ইন করা হয়। আনুমানিক স্থানাঙ্ক আপনার প্রোফাইল ও ঋণ আবেদনের চেক-ইনের সাথে সংরক্ষিত থাকে।",
              "**নোটিফিকেশন টোকেন** — ফায়ারবেস ক্লাউড মেসেজিং-এর একটি ডিভাইস টোকেন, যাতে আমরা আপনাকে নোটিফিকেশন পাঠাতে পারি।",
              "**প্রযুক্তিগত তথ্য** — অ্যাপের সংস্করণ ও ফোনের প্ল্যাটফর্ম, অনুরোধের আইপি ঠিকানা (নিরাপত্তা ও লগইন কোডের অপব্যবহার ঠেকাতে), এবং শাথী আপা স্ক্রিনের ত্রুটির রিপোর্ট।"
            ]
          },
          "অ্যাপ আপনার কন্টাক্ট, এসএমএস, কল লগ বা ফোনের ছবি পড়ে না। আপনি যে ছবি শেয়ার করতে বেছে নেন, শুধু সেটিই পায়।"
        ]
      },
      {
        id: "how-we-use",
        title: "আমরা তথ্য কীভাবে ব্যবহার করি",
        body: [
          {
            list: [
              "আপনার অ্যাকাউন্ট খোলা, লগইন করানো ও সুরক্ষিত রাখা।",
              "আপনি যে সেবা চান তা দেওয়া: কেনাবেচা, পার্টনার প্রকল্প, শিখন, কমিউনিটি, আবহাওয়া ও শাথী আপা।",
              "মাঠ কর্মকর্তার পরিদর্শনসহ আপনার পরিচয় ও খামার যাচাই করা।",
              "ঋণ-প্রস্তুতি যাচাই, ঋণের আবেদন তৈরি এবং — শুধু আপনার সম্মতিতে — তা ঋণদাতার কাছে পাঠানো।",
              "আপনার অর্ডার, তালিকা, আবেদন ও অ্যাকাউন্ট সম্পর্কে নোটিফিকেশন পাঠানো: অ্যাপে, পুশ নোটিফিকেশনে, এসএমএসে, এবং আপনি ইমেইল ঠিকানা দিয়ে থাকলে ইমেইলে।",
              "কমিউনিটি নিরাপদ রাখা, পোস্ট মডারেট করা এবং প্রতারণা ও অপব্যবহার ঠেকানো।",
              "আমাদের আইনগত, হিসাবরক্ষণ ও কর-সংক্রান্ত বাধ্যবাধকতা পূরণ করা।"
            ]
          },
          "আমরা আপনার ব্যক্তিগত তথ্য বিক্রি করি না এবং বিজ্ঞাপনের জন্য ব্যবহার করি না।"
        ]
      },
      {
        id: "sharing",
        title: "যাদের সাথে তথ্য শেয়ার করা হয়",
        body: [
          {
            list: [
              "**ঋণদাতা** — ব্যাংক, ক্ষুদ্রঋণ প্রতিষ্ঠান ও অন্যান্য পার্টনার ঋণদাতা আপনার আবেদন পায় শুধু তখনই, যখন আপনি ঋণের আবেদন করেন এবং তা শেয়ার করতে সম্মতি দেন। মূল্যায়নের জন্য যা দরকার তারা তা-ই পায়: আপনার পরিচয় ও কেওয়াইসি তথ্য, আবেদন এবং আমাদের মূল্যায়ন। ঋণ দেওয়া হবে কি না, সে সিদ্ধান্ত ঋণদাতার; তারা নিজেদের গোপনীয়তা নীতি অনুযায়ী নিজেদের রেকর্ড রাখে।",
              "**আচরণগত মূল্যায়ন** — ঋণের আবেদন করে আপনি সম্মতি দিলে, আমাদের মূল্যায়ন-পার্টনার এমপাওয়ারইউ (mPowerU) একটি ছদ্মনামযুক্ত আইডিতে একটি ছোট প্রশ্নমালা পরিচালনা করে।",
              "**ক্রেতা ও পরিবেশক** — বিক্রি সম্পন্ন করতে বা অর্ডার পৌঁছে দিতে সংশ্লিষ্ট ক্রেতা বা পরিবেশককে প্রয়োজনীয় তথ্য দেওয়া হয়, যেমন আপনার নাম, এলাকা ও ডেলিভারির ঠিকানা।",
              "**অন্য ব্যবহারকারী** — কমিউনিটির পোস্ট ও মন্তব্য এবং বিক্রির তালিকা অন্য শাথী সেবা ব্যবহারকারীরা আপনার নাম ও এলাকাসহ দেখতে পান।",
              "**সেবা প্রদানকারী**, যারা আমাদের হয়ে তথ্য প্রক্রিয়া করে: **অ্যামাজন ওয়েব সার্ভিসেস** (আমাদের ডেটাবেস এবং আপনার আপলোড করা ছবি ও কাগজপত্র, অ্যামাজন এস৩-তে, এডব্লিউএস-এর সিঙ্গাপুর অঞ্চলে; অ্যামাজন এসইএস-এর মাধ্যমে ইমেইল পাঠানো); **গুগল** (নোটিফিকেশনের জন্য ফায়ারবেস ক্লাউড মেসেজিং; এবং গুগল জেমিনি — যা শাথী আপার প্রশ্ন, ভয়েস রেকর্ডিং ও ছবি প্রক্রিয়া করে, তালিকার বিবরণ লিখতে ও তালিকার ছবি বুঝতে সাহায্য করে, লেখা পড়ে শোনায়, এবং আমাদের কর্মীদের কমিউনিটি পোস্ট মডারেট করতে ও আপলোড করা কাগজ পড়তে সাহায্য করে); **বাল্কএসএমএসবিডি** (লগইন কোডসহ এসএমএস পাঠানো); এবং **ওয়েদারএপিআই** (স্থানীয় আবহাওয়ার পূর্বাভাস আনতে অ্যাপ আপনার আনুমানিক অবস্থান WeatherAPI.com-এ পাঠায়)।",
              "**কর্তৃপক্ষ** — আইন অনুযায়ী প্রয়োজন হলে, অথবা ব্যবহারকারী ও জনসাধারণের নিরাপত্তা ও অধিকার রক্ষায়।"
            ]
          }
        ]
      },
      {
        id: "storage",
        title: "তথ্য কোথায় রাখা হয়",
        body: [
          "আপনার তথ্য অ্যামাজন ওয়েব সার্ভিসেস-এর সিঙ্গাপুর অঞ্চলে সংরক্ষিত থাকে: আমাদের ডেটাবেস এবং আপনার আপলোড করা ছবি ও কাগজপত্র। পরিচয়ের কাগজপত্র গোপন স্টোরেজে রাখা হয় এবং শুধু আপনি ও অনুমোদিত কর্মীরা দেখতে পান। ওপরে বলা কিছু সেবা প্রদানকারী অন্য দেশেও তথ্য প্রক্রিয়া করতে পারে।"
        ]
      },
      {
        id: "retention",
        title: "তথ্য কতদিন রাখা হয়",
        body: [
          {
            list: [
              "অ্যাকাউন্ট চালু থাকা পর্যন্ত, অ্যাপ চালানোর জন্য আমরা আপনার তথ্য রাখি।",
              "লগইন কোডের মেয়াদ ৫ মিনিট।",
              "শাথী আপার কথোপকথনের ইতিহাস আপনি যেকোনো সময় অ্যাপ থেকে মুছে ফেলতে পারেন।",
              "অ্যাকাউন্ট মুছে ফেললে আমরা সঙ্গে সঙ্গে আপনার ব্যক্তিগত তথ্য মুছে ফেলি — দেখুন [অ্যাকাউন্ট মুছে ফেলুন](/delete-account)। একটি প্রতিষ্ঠানের যা রাখা বাধ্যতামূলক, শুধু সেই রেকর্ড — অর্ডার, বিক্রি ও পেমেন্ট, ঋণের আবেদন, ঋণ হিসাব ও কিস্তি পরিশোধ, এবং পার্টনার প্রকল্পের রেকর্ড — **৫ বছর** রাখা হয়, আপনার নাম, মোবাইল নম্বর, এনআইডি, ঠিকানা, ছবি, কাগজপত্র ও অন্যান্য শনাক্তকারী তথ্য সরিয়ে। ৫ বছর পর সেগুলোও মুছে ফেলা হয়।",
              "যে ঋণদাতারা আপনার আবেদন পেয়েছে, তারা নিজেদের নীতি অনুযায়ী নিজেদের রেকর্ড রাখে।"
            ]
          }
        ]
      },
      {
        id: "your-rights",
        title: "আপনার অধিকার ও পছন্দ",
        body: [
          {
            list: [
              "অ্যাপে আপনার প্রোফাইল **দেখুন ও সংশোধন করুন**। কিছু পরিবর্তন কার্যকর হওয়ার আগে আমাদের কর্মীরা যাচাই করেন।",
              "অনুমোদনের আগে অ্যাপ থেকে ঋণের আবেদন **প্রত্যাহার** করতে পারেন।",
              "**অবস্থান ও নোটিফিকেশন** যেকোনো সময় ফোনের সেটিংস থেকে বন্ধ করতে পারেন। স্থানীয় আবহাওয়া ও ঋণের চেক-ইনের জন্য অবস্থান লাগে।",
              "**অ্যাকাউন্ট মুছে ফেলুন** — অ্যাপ থেকে (মেনু → অ্যাকাউন্ট মুছে ফেলুন), অথবা ওয়েবে [shathisheba.digigramventures.com/delete-account](/delete-account) পাতায় মোবাইল নম্বর ও এসএমএসে পাঠানো কোড দিয়ে। কোড না পেলে আমাদের ইমেইল করুন।",
              `আপনার তথ্যের কপি বা তথ্য নিয়ে যেকোনো অনুরোধে **আমাদের লিখুন**: ${MAIL}।`
            ]
          }
        ]
      },
      {
        id: "security",
        title: "নিরাপত্তা",
        body: [
          "আমরা এনক্রিপ্ট করা সংযোগ (এইচটিটিপিএস) ব্যবহার করি। লগইন কোড স্বল্পমেয়াদি ও সীমিত, পরিচয়ের কাগজপত্র গোপন স্টোরেজে রাখা হয়, এবং কর্মীদের প্রবেশাধিকার ভূমিকা অনুযায়ী সীমিত ও তাদের কাজের রেকর্ড রাখা হয়। কোনো ব্যবস্থাই শতভাগ নিরাপদ নয়, তাই আপনার ফোন ও কোড নিজের কাছে রাখুন।"
        ]
      },
      {
        id: "children",
        title: "শিশু",
        body: [
          "শাথী সেবা ১৮ বছর বা তার বেশি বয়সীদের জন্য। আমরা জেনেশুনে ১৮ বছরের কম বয়সী কারও তথ্য সংগ্রহ করি না। কোনো শিশু অ্যাকাউন্ট খুলেছে বলে মনে হলে আমাদের জানান, আমরা তা মুছে ফেলব।"
        ]
      },
      {
        id: "changes",
        title: "এই নীতির পরিবর্তন",
        body: [
          "কোনো পরিবর্তন হলে আমরা এই পাতায় প্রকাশ করব এবং ওপরের তারিখ হালনাগাদ করব। বড় পরিবর্তন হলে অ্যাপেও জানাব।"
        ]
      },
      {
        id: "contact",
        title: "যোগাযোগ",
        body: [`ডিজিগ্রাম ভেঞ্চারস লিমিটেড, বাংলাদেশ — ${MAIL}`]
      }
    ]
  }
};

export default async function PrivacyPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const lang = await resolveLang(searchParams);
  const c = CONTENT[lang];
  return (
    <PublicShell lang={lang} path="/privacy" title={c.title} subtitle={c.subtitle}>
      <Contents title={c.contents} sections={c.sections} />
      <Sections sections={c.sections} />
    </PublicShell>
  );
}
