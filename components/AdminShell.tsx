"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  BellRing,
  BookOpen,
  Boxes,
  ChevronDown,
  CloudSun,
  CreditCard,
  GraduationCap,
  HandCoins,
  Headset,
  HelpCircle,
  LayoutDashboard,
  ListChecks,
  LogOut,
  MapPin,
  MessageSquareText,
  PackageCheck,
  Pencil,
  ReceiptText,
  ScrollText,
  Search,
  Settings2,
  ShieldCheck,
  ShoppingCart,
  Sparkles,
  Store,
  Tags,
  Trophy,
  UsersRound
} from "lucide-react";

type NavLink = { label: string; href: string; icon: typeof LayoutDashboard };
type NavSection = { title: string; icon: typeof LayoutDashboard; items: NavLink[] };

// Flat quick-access items pinned at the top of the sidebar.
const pinned: NavLink[] = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "Approvals", href: "/approvals", icon: ListChecks },
  { label: "API Viewer", href: "/api-viewer", icon: ScrollText }
];

// Grouped, collapsible (cascading) navigation. Trimmed of the redundant
// "Product Catalogue" (duplicate of Products) and the static "Reports" stub.
const sections: NavSection[] = [
  {
    title: "Content & CMS",
    icon: GraduationCap,
    items: [
      { label: "Market Updates", href: "/market-updates", icon: BellRing },
      { label: "Weather Alerts", href: "/weather", icon: CloudSun },
      { label: "Learning CMS", href: "/learning", icon: GraduationCap },
      { label: "Learning Studio", href: "/learning/studio", icon: Pencil },
      { label: "Learning Progress", href: "/learning/progress", icon: Trophy },
      { label: "Ask Shathi Apa", href: "/assistant", icon: Sparkles },
      { label: "FAQ & Help", href: "/faq", icon: HelpCircle },
      { label: "App Interests", href: "/interests", icon: Boxes }
    ]
  },
  {
    title: "Marketplace",
    icon: Store,
    items: [
      { label: "All Listings", href: "/sale", icon: Store },
      { label: "Sale Categories", href: "/sale/categories", icon: Tags },
      { label: "Sale Items", href: "/sale/items", icon: ListChecks },
      { label: "Animal Master", href: "/sale/animals", icon: Boxes },
      { label: "Animal Breeds", href: "/sale/breeds", icon: Boxes },
      { label: "Pricing Rules", href: "/sale/pricing", icon: ReceiptText },
      { label: "Payment Confirmations", href: "/sale/confirmations", icon: ShieldCheck }
    ]
  },
  {
    title: "Geography",
    icon: MapPin,
    items: [
      { label: "Divisions", href: "/geo/divisions", icon: MapPin },
      { label: "Districts", href: "/geo/districts", icon: MapPin },
      { label: "Upazilas / Thanas", href: "/geo/upazilas", icon: MapPin }
    ]
  },
  {
    title: "Buy & Orders",
    icon: ShoppingCart,
    items: [
      { label: "Products", href: "/buy/products", icon: PackageCheck },
      { label: "Buy Categories", href: "/buy/categories", icon: Tags },
      { label: "Placed Orders", href: "/orders", icon: ShoppingCart },
      { label: "Inventory", href: "/orders/inventory", icon: Boxes },
      { label: "Payments", href: "/orders/payments", icon: CreditCard }
    ]
  },
  {
    title: "Partners & KYC",
    icon: HandCoins,
    items: [
      { label: "Projects", href: "/partners", icon: HandCoins },
      { label: "KYC Approvals", href: "/kyc", icon: ShieldCheck }
    ]
  },
  {
    title: "Community",
    icon: MessageSquareText,
    items: [
      { label: "Posts & Moderation", href: "/community", icon: MessageSquareText },
      { label: "Zone Officers", href: "/community/officers", icon: Headset },
      { label: "Reported Posts", href: "/community/reports", icon: BookOpen }
    ]
  },
  {
    title: "Users",
    icon: UsersRound,
    items: [
      { label: "All Users", href: "/users", icon: UsersRound },
      { label: "User Roles", href: "/users/roles", icon: ShieldCheck },
      { label: "Banking", href: "/users/banking", icon: CreditCard },
      { label: "Farm Info", href: "/users/farm", icon: Boxes },
      { label: "KYC Documents", href: "/users/kyc", icon: ScrollText }
    ]
  },
  {
    title: "System",
    icon: Settings2,
    items: [
      { label: "Admin Users", href: "/admin-users", icon: ShieldCheck },
      { label: "Settings", href: "/settings", icon: Settings2 }
    ]
  }
];

function isActive(pathname: string, href: string) {
  return pathname === href;
}

function sectionHasActive(pathname: string, section: NavSection) {
  return section.items.some((item) => isActive(pathname, item.href));
}

function SidebarNav() {
  const pathname = usePathname() ?? "";
  const [q, setQ] = useState("");
  // Open the group that contains the active route; collapse the rest. The user
  // can toggle any group, with the open set tracked in state.
  const [open, setOpen] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    for (const section of sections) initial[section.title] = sectionHasActive(pathname, section);
    return initial;
  });

  function toggle(title: string) {
    setOpen((prev) => ({ ...prev, [title]: !prev[title] }));
  }

  const query = q.trim().toLowerCase();
  const searchResults: Array<{ label: string; href: string; icon: typeof LayoutDashboard; group: string }> = query
    ? [
        ...pinned.map((i) => ({ ...i, group: "Quick" })),
        ...sections.flatMap((s) => s.items.map((i) => ({ ...i, group: s.title })))
      ].filter((i) => i.label.toLowerCase().includes(query) || i.group.toLowerCase().includes(query))
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
          {searchResults.length === 0 ? <p className="nav-search-empty">No menu items match “{q}”.</p> : null}
          {searchResults.map((item) => (
            <Link className={`nav-item${isActive(pathname, item.href) ? " active" : ""}`} href={item.href} key={item.href + item.group} title={item.group}>
              <item.icon />
              <span className="nav-item-label">{item.label}</span>
              <span className="nav-item-group">{item.group}</span>
            </Link>
          ))}
        </nav>
      ) : (
      <>
      <nav className="nav-pinned">
        {pinned.map((item) => (
          <Link className={`nav-item${isActive(pathname, item.href) ? " active" : ""}`} href={item.href} key={item.href}>
            <item.icon />
            {item.label}
          </Link>
        ))}
      </nav>

      {sections.map((section) => {
        const expanded = open[section.title] || sectionHasActive(pathname, section);
        return (
          <div className={`nav-accordion${expanded ? " open" : ""}`} key={section.title}>
            <button className="nav-accordion-head" onClick={() => toggle(section.title)} type="button">
              <section.icon className="nav-accordion-icon" />
              <span>{section.title}</span>
              <ChevronDown className="nav-chevron" />
            </button>
            <div className="nav-accordion-body">
              {section.items.map((item) => (
                <Link className={`nav-item${isActive(pathname, item.href) ? " active" : ""}`} href={item.href} key={item.href}>
                  <item.icon />
                  {item.label}
                </Link>
              ))}
            </div>
          </div>
        );
      })}
      </>
      )}
    </>
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
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link className="brand" href="/dashboard">
          <div className="brand-mark" />
          <div>
            <h1>Shathi Sheba</h1>
            <p>Admin Backend</p>
          </div>
        </Link>

        <div className="sidebar-summary">
          <span>Live MySQL</span>
          <strong>Admin Console</strong>
        </div>

        <SidebarNav />

        <AdminIdentity />
      </aside>

      <main className="main">{children}</main>

      <nav className="mobile-nav">
        <Link href="/dashboard"><LayoutDashboard size={18} />Home</Link>
        <Link href="/sale"><Store size={18} />Sale</Link>
        <Link href="/community"><MessageSquareText size={18} />Community</Link>
        <Link href="/api-viewer"><ScrollText size={18} />API</Link>
      </nav>
    </div>
  );
}
