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

Create a `.env.local` file in the root directory and configure the keys required for database connections, authentication, and Gemini AI features:

```env
# Authentication & App Roles
NEXTAUTH_SECRET=your_next_auth_secret
NEXTAUTH_URL=http://localhost:3000

# Database Configuration
DATABASE_URL=your_database_connection_string

# Gemini AI Integration
GEMINI_API_KEY=your_gemini_ai_api_key

# Additional Services
NEXT_PUBLIC_API_URL=your_backend_api_url

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
