"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  GraduationCap,
  HandCoins,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Menu,
  X,
  MapPin,
  Megaphone,
  MessageSquareText,
  PackageCheck,
  ScrollText,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  ShoppingCart,
  Store,
  UsersRound
} from "lucide-react";

type NavTab = { label: string; href: string };
type NavGroup = { label: string; icon: typeof LayoutDashboard; tabs: NavTab[] };

// The sidebar used to list some sixty pages in eleven accordions, with the page
// you wanted usually folded away in a closed one. It now lists destinations;
// the pages inside a destination are tabs across the top of the page itself
// (SectionTabs), so related screens are one click apart and the sidebar fits
// on a laptop screen without scrolling.
const groups: NavGroup[] = [
  { label: "Dashboard", icon: LayoutDashboard, tabs: [{ label: "Dashboard", href: "/dashboard" }] },
  {
    label: "Approvals", icon: ListChecks, tabs: [
      { label: "Approval queue", href: "/approvals" },
      { label: "Profile changes", href: "/users/change-requests" }
    ]
  },
  {
    // Loan operations sit high because they are the highest-frequency daily
    // work for field officers and credit staff.
    label: "Loans", icon: HandCoins, tabs: [
      { label: "Applications", href: "/loan/applications" },
      { label: "Credit dashboard", href: "/loan/dashboard" },
      { label: "Readiness checks", href: "/loan/readiness-checks" },
      { label: "Loan accounts", href: "/loan/accounts" },
      { label: "Collections", href: "/loan/collections" },
      { label: "Lender submissions", href: "/loan/lenders" }
    ]
  },
  {
    label: "Loan setup", icon: Settings2, tabs: [
      { label: "Products", href: "/loan/products" },
      { label: "Lenders", href: "/loan/lenders-setup" },
      { label: "Questionnaire", href: "/loan/questionnaire" },
      { label: "Scorecard criteria", href: "/loan/scorecard-criteria" },
      { label: "Scorecard rules", href: "/loan/scorecard-rules" },
      { label: "Hard stops", href: "/loan/hard-stops" },
      { label: "Reason codes", href: "/loan/reason-codes" },
      { label: "Pathway rules", href: "/loan/pathway-rules" },
      { label: "Development tasks", href: "/loan/development-templates" },
      { label: "Corroboration signals", href: "/loan/confidence-signals" },
      { label: "Consent types", href: "/loan/consent-types" },
      { label: "Loan purposes", href: "/loan/purposes" }
    ]
  },
  {
    label: "Marketplace", icon: Store, tabs: [
      { label: "Listings", href: "/sale" },
      { label: "Categories", href: "/sale/categories" },
      { label: "Items", href: "/sale/items" },
      { label: "Animals", href: "/sale/animals" },
      { label: "Breeds", href: "/sale/breeds" },
      { label: "Price rules", href: "/sale/pricing" },
      { label: "Payment confirmations", href: "/sale/confirmations" }
    ]
  },
  {
    label: "Buy & orders", icon: ShoppingCart, tabs: [
      { label: "Products", href: "/buy/products" },
      { label: "Categories", href: "/buy/categories" },
      { label: "Manufacturers", href: "/buy/manufacturers" },
      { label: "Distributors", href: "/buy/distributors" },
      { label: "Orders", href: "/orders" },
      { label: "Inventory", href: "/orders/inventory" },
      { label: "Payments", href: "/orders/payments" },
      { label: "Promotions", href: "/buy/promotions" },
      { label: "Discounts given", href: "/buy/redemptions" },
      { label: "Vouchers", href: "/buy/vouchers" }
    ]
  },
  {
    label: "Projects & KYC", icon: PackageCheck, tabs: [
      { label: "Projects", href: "/partners" },
      { label: "KYC approvals", href: "/kyc" }
    ]
  },
  {
    label: "Community", icon: MessageSquareText, tabs: [
      { label: "Posts", href: "/community" },
      { label: "Field officers", href: "/community/officers" },
      { label: "Reported posts", href: "/community/reports" }
    ]
  },
  {
    label: "Content", icon: GraduationCap, tabs: [
      { label: "Market updates", href: "/market-updates" },
      { label: "Weather alerts", href: "/weather" },
      { label: "Learning CMS", href: "/learning" },
      { label: "Learning studio", href: "/learning/studio" },
      { label: "Learning progress", href: "/learning/progress" },
      { label: "FAQ & help", href: "/faq" },
      { label: "App interests", href: "/interests" }
    ]
  },
  {
    // The assistant's own console. Seven pages because seven different people
    // ask seven different questions of it: what are farmers asking, what did
    // the scope gate get wrong, what is it costing, who is it reaching.
    label: "Shathi Apa", icon: Sparkles, tabs: [
      { label: "Conversations", href: "/apa" },
      { label: "Scope review", href: "/apa/scope" },
      { label: "Vocabulary", href: "/apa/vocabulary" },
      { label: "Voice config", href: "/apa/config" },
      { label: "Usage & cost", href: "/apa/usage" },
      { label: "Access & tiers", href: "/apa/access" },
      { label: "Feedback", href: "/apa/feedback" },
      { label: "Home card prompts", href: "/assistant" }
    ]
  },
  {
    // What reaches farmers outside the screens they open: the home strip,
    // push, in-app and email.
    label: "Engagement", icon: Megaphone, tabs: [
      { label: "Home partners", href: "/home/partners" },
      { label: "Send notification", href: "/notifications/send" },
      { label: "Templates", href: "/notifications/templates" },
      { label: "Broadcasts", href: "/notifications/broadcasts" },
      { label: "Delivery log", href: "/notifications/log" }
    ]
  },
  {
    label: "Users", icon: UsersRound, tabs: [
      { label: "All users", href: "/users" },
      { label: "Act for a farmer", href: "/act" },
      { label: "Roles", href: "/users/roles" },
      { label: "Banking", href: "/users/banking" },
      { label: "Farm info", href: "/users/farm" },
      { label: "KYC documents", href: "/users/kyc" },
      { label: "Clear records", href: "/users/clear-records" }
    ]
  },
  {
    label: "Geography", icon: MapPin, tabs: [
      { label: "Hierarchy", href: "/geo" },
      { label: "Divisions", href: "/geo/divisions" },
      { label: "Districts", href: "/geo/districts" },
      { label: "Upazilas", href: "/geo/upazilas" }
    ]
  },
  {
    label: "Settings", icon: ShieldCheck, tabs: [
      { label: "Geo filters", href: "/settings" },
      { label: "Platform switches", href: "/settings/switches" },
      { label: "Admin users", href: "/admin-users" },
      { label: "Media library", href: "/settings/media" },
      { label: "Audit trail", href: "/settings/audit" },
      { label: "API viewer", href: "/api-viewer" }
    ]
  }
];

/**
 * The tab a path belongs to: the longest tab href that is the path itself or a
 * parent of it, so /sale/pricing/new lands on "Price rules", not "Listings".
 */
function locate(pathname: string): { group: NavGroup; tab: NavTab } | null {
  let best: { group: NavGroup; tab: NavTab; score: number } | null = null;
  for (const group of groups) {
    for (const tab of group.tabs) {
      const score = pathname === tab.href ? tab.href.length + 1 : pathname.startsWith(`${tab.href}/`) ? tab.href.length : -1;
      if (score > (best?.score ?? -1)) best = { group, tab, score };
    }
  }
  return best ? { group: best.group, tab: best.tab } : null;
}

function SidebarNav() {
  const pathname = usePathname() ?? "";
  const [q, setQ] = useState("");
  const here = locate(pathname);

  const query = q.trim().toLowerCase();
  const results = query
    ? groups.flatMap((g) => g.tabs.map((t) => ({ ...t, group: g.label, icon: g.icon })))
        .filter((t) => t.label.toLowerCase().includes(query) || t.group.toLowerCase().includes(query))
    : [];

  return (
    <>
      <div className="nav-search">
        <Search size={15} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search menu…" aria-label="Search menu" />
        {q ? <button type="button" className="nav-search-clear" onClick={() => setQ("")}>×</button> : null}
      </div>

      {query ? (
        <nav className="nav-search-results">
          {results.length === 0 ? <p className="nav-search-empty">No menu items match “{q}”.</p> : null}
          {results.map((item) => (
            <Link
              className={`nav-item${here?.tab.href === item.href ? " active" : ""}`}
              aria-current={here?.tab.href === item.href ? "page" : undefined}
              href={item.href}
              key={item.href + item.group}
              title={item.group}
            >
              <item.icon />
              <span className="nav-item-label">{item.label}</span>
              <span className="nav-item-group">{item.group}</span>
            </Link>
          ))}
        </nav>
      ) : (
        <nav className="nav-pinned">
          {groups.map((group) => (
            <Link
              className={`nav-item${here?.group === group ? " active" : ""}`}
              aria-current={here?.group === group ? "page" : undefined}
              href={group.tabs[0].href}
              key={group.label}
            >
              <group.icon />
              <span className="nav-item-label">{group.label}</span>
              {group.tabs.length > 1 ? <span className="nav-item-group">{group.tabs.length}</span> : null}
            </Link>
          ))}
        </nav>
      )}
    </>
  );
}

/** Every page in the current sidebar destination, as tabs above the content. */
function SectionTabs() {
  const pathname = usePathname() ?? "";
  const here = locate(pathname);
  if (!here || here.group.tabs.length < 2) return null;
  return (
    <nav className="section-tabs" aria-label={`${here.group.label} pages`}>
      {here.group.tabs.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          className={here.tab.href === tab.href ? "active" : ""}
          aria-current={here.tab.href === tab.href ? "page" : undefined}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}

function AdminIdentity() {
  const router = useRouter();
  const [admin, setAdmin] = useState<{ name: string; role: string } | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/admin/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!alive) return;
        if (j?.ok) setAdmin({ name: j.admin.name, role: j.admin.role });
        else router.replace("/login");
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [router]);

  async function logout() {
    await fetch("/api/admin/logout", { method: "POST" }).catch(() => {});
    router.replace("/login");
    router.refresh();
  }

  const initials = (admin?.name || "A")
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  const roleLabel = (admin?.role || "").replace(/_/g, " ");

  return (
    <div className="admin-id-wrap">
      <div className="admin-id">
        <div className="admin-id-avatar">{initials}</div>
        <div className="admin-id-meta">
          <div className="admin-id-name">{admin?.name ?? "…"}</div>
          <div className="admin-id-role">{roleLabel}</div>
        </div>
      </div>
      <button type="button" className="admin-logout" onClick={logout}>
        <LogOut size={15} /> Sign out
      </button>
    </div>
  );
}

export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "";
  const [drawer, setDrawer] = useState(false);
  // A tap on any destination navigates; close the drawer behind it.
  useEffect(() => { setDrawer(false); }, [pathname]);
  const sidebarBody = (
    <>
      <Link className="brand" href="/dashboard">
        <div className="brand-mark" />
        <div>
          <h1>Shathi Sheba</h1>
          <p>Admin Backend</p>
        </div>
      </Link>

      <div className="sidebar-summary">
        <span>Live</span>
        <strong>MySQL · production data</strong>
      </div>

      <SidebarNav />

      <AdminIdentity />
    </>
  );

  return (
    <div className="app-shell">
      <aside className="sidebar">{sidebarBody}</aside>

      <main className="main">
        <SectionTabs />
        {children}
      </main>

      {/* Phones and tablets: the sidebar lives in a drawer behind "Menu". */}
      {drawer ? (
        <div className="mobile-drawer" role="dialog" aria-modal="true" aria-label="Menu" onClick={() => setDrawer(false)}>
          <aside className="sidebar mobile-drawer-panel" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="mobile-drawer-close" onClick={() => setDrawer(false)} aria-label="Close menu"><X size={20} /></button>
            {sidebarBody}
          </aside>
        </div>
      ) : null}

      <nav className="mobile-nav">
        <Link href="/dashboard" className={pathname === "/dashboard" ? "active" : ""}><LayoutDashboard size={18} />Home</Link>
        <Link href="/approvals" className={pathname.startsWith("/approvals") ? "active" : ""}><ListChecks size={18} />Approvals</Link>
        <Link href="/orders" className={pathname.startsWith("/orders") ? "active" : ""}><ShoppingCart size={18} />Orders</Link>
        <button type="button" onClick={() => setDrawer(true)}><Menu size={18} />Menu</button>
      </nav>
    </div>
  );
}
