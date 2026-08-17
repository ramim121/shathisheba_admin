# Shathi Sheba Admin Dashboard

An advanced admin management application built with Next.js, TypeScript, and Tailwind CSS for the Shathi Sheba platform. The application features community moderation, Gemini AI flagging capabilities, role-based authentication, and gamified learning modules.

---

## 🚀 Deployment Guide

This project is built using Next.js and is optimized for deployment on **Vercel**, though it can be hosted on any platform supporting Node.js or Docker.

### Option 1: Deploying to Vercel (Recommended)

Since the project is already wired up to Vercel (`shathisheba-admin.vercel.app`), follow these steps to deploy or update your build:

1. **Push your changes** to your GitHub repository (`main` branch).
2. **Connect to Vercel**:
* Go to your [Vercel Dashboard](https://www.google.com/search?q=https://vercel.com).
* Import the `shathisheba_admin` repository if you haven't already.


3. **Configure Environment Variables**:
* In the Vercel project settings, add the keys from your local `.env.local` file (see the [Environment Variables](https://www.google.com/search?q=%23-environment-variables) section below).


4. **Deploy**:
* Click **Deploy**. Vercel will automatically build and deploy your application. Subsequent pushes to `main` will trigger automatic production deployments.



### Option 2: Manual Self-Hosting (Node.js Server)

To deploy this on a Virtual Private Server (VPS) like DigitalOcean, AWS EC2, or Linode:

1. **Clone and Install Dependencies**:
```bash
git clone https://github.com/ramim121/shathisheba_admin.git
cd shathisheba_admin
npm install --production

```


2. **Build the Application**:
```bash
npm run build

```


3. **Start the Production Server**:
Using a process manager like `pm2` is highly recommended to keep the app alive:
```bash
npm install -g pm2
pm2 start npm --name "shathisheba-admin" -- start --max-memory-restart 500M

```



---

## 🛠️ Getting Started (Local Development)

### Prerequisites

* Node.js (v18.x or higher recommended)
* npm or yarn

### Installation

1. Clone the repository:
```bash
git clone https://github.com/ramim121/shathisheba_admin.git
cd shathisheba_admin

```


2. Install dependencies:
```bash
npm install

```


3. Set up your environment variables (see below).
4. Run the development server:
```bash
npm run dev

```


Open [http://localhost:3000](https://www.google.com/search?q=http://localhost:3000) with your browser to see the live local interface.

---

## 🔑 Environment Variables

Create a `.env.local` file in the root directory. **These are the exact variable
names the code reads** — `lib/db.ts` builds the MySQL pool from the five
`MYSQL_*` values individually, and there is no `DATABASE_URL` anywhere in the
codebase.

> ⚠️ **If you are configuring Vercel, use this list.** An earlier version of this
> file documented `DATABASE_URL`, `NEXTAUTH_SECRET` and `NEXTAUTH_URL`. None of
> those are read by the application. A deployment configured from that list has
> no database credentials at all: static routes such as `/api/v1/catalog` still
> answer 200 because they return a hard-coded array, while every database-backed
> route returns 500. That failure mode looks like a healthy deployment and is not.

```env
# Database — all five are required (lib/db.ts)
MYSQL_HOST=your_mysql_host
MYSQL_PORT=3306
MYSQL_USER=your_mysql_user
MYSQL_PASSWORD=your_mysql_password
MYSQL_DATABASE=shathi_sheba

# Gemini AI — server-side moderation and content tools
GEMINI_API_KEY=your_gemini_api_key

# S3 — media is public-read; the kyc/ folder is private and served via presigned redirects
S3_BUCKET_NAME=your_bucket
S3_BUCKET_REGION=ap-southeast-1
S3_ACCESS_KEY_ID=your_access_key
S3_SECRET_ACCESS_KEY=your_secret_key
S3_PUBLIC_URL=https://your-bucket.s3.ap-southeast-1.amazonaws.com

# BulkSMSBD — OTP delivery
BULKSMSBD_API_KEY=your_api_key
BULKSMSBD_SENDER_ID=your_sender_id
OTP_BRAND=Shathi Sheba

# OTP behaviour
# true  -> no SMS is sent and the code is returned in the response (use for testing)
# false -> real SMS is delivered and costs credits
OTP_DEV_MODE=false
# Master code that verifies any number. Refused outright when NODE_ENV=production.
# Leave empty.
OTP_DEV_MASTER=
```

**Admin authentication does not use NextAuth.** Sessions are rows in
`admin_sessions` behind an httpOnly `admin_session` cookie (`lib/admin-auth.ts`),
so no `NEXTAUTH_*` variable is needed.

To verify a deployment is actually wired to the database, call a route that
reads from it — not `/api/v1/catalog`, which passes without a database:

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://<your-deployment>/api/v1/geo/divisions
# 200 = connected · 500 = the MYSQL_* variables are missing or wrong
```

> ⚠️ **Important:** Never commit your `.env.local` file to GitHub. It is already added to the `.gitignore` to prevent credential exposure.

---

## 📦 Project Structure

```text
├── app/                  # Next.js App Router (Pages, Layouts, and API Routes)
├── components/           # Reusable UI Components
├── database/             # Database schemas, clients, and migrations
├── docs/                 # Documentation and architecture references
├── lib/                  # Helper utilities, Gemini AI configurations, and shared libraries
├── scripts/              # Automation and seed scripts
├── next.config.ts        # Next.js configuration settings
└── tsconfig.json         # TypeScript configuration settings

```

---

## 🛠️ Tech Stack

* **Framework:** [Next.js](https://www.google.com/search?q=https://nextjs.org/) (App Router)
* **Language:** [TypeScript](https://www.google.com/search?q=https://www.typescriptlang.org/)
* **Styling:** Tailwind CSS
* **AI Engine:** Google Gemini AI (Content Moderation & Flagging)
