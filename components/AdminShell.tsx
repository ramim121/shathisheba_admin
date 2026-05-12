import Link from "next/link";
import {
  BellRing,
  BookOpen,
  Boxes,
  CloudSun,
  CreditCard,
  FileText,
  GraduationCap,
  HandCoins,
  LayoutDashboard,
  ListChecks,
  MessageSquareText,
  PackageCheck,
  PanelLeft,
  ReceiptText,
  ScrollText,
  Settings2,
  ShieldCheck,
  ShoppingCart,
  Store,
  Tags,
  UsersRound
} from "lucide-react";

const sections = [
  {
    title: "Command",
    items: [
      { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
      { label: "Reports", href: "/reports", icon: FileText },
      { label: "API Viewer", href: "/api-viewer", icon: ScrollText }
    ]
  },
  {
    title: "Setups",
    items: [
      { label: "App Interests", href: "/interests", icon: Boxes },
      { label: "Weather Alerts", href: "/weather", icon: CloudSun },
      { label: "Market Updates", href: "/market-updates", icon: BellRing },
      { label: "Learning CMS", href: "/learning", icon: GraduationCap },
      { label: "Users", href: "/users", icon: UsersRound },
      { label: "Settings", href: "/settings", icon: Settings2 }
    ]
  },
  {
    title: "Sale Listings",
    items: [
      { label: "All Listings", href: "/sale", icon: Store },
      { label: "Sale Categories", href: "/sale/categories", icon: Tags },
      { label: "Sale Items", href: "/sale/items", icon: ListChecks },
      { label: "Animal Breeds", href: "/sale/breeds", icon: PanelLeft },
      { label: "Pricing Rules", href: "/sale/pricing", icon: ReceiptText }
    ]
  },
  {
    title: "Buy Listings",
    items: [
      { label: "Product Catalogue", href: "/buy", icon: ShoppingCart },
      { label: "Buy Categories", href: "/buy/categories", icon: Tags },
      { label: "Products", href: "/buy/products", icon: PackageCheck }
    ]
  },
  {
    title: "Orders",
    items: [
      { label: "Placed Orders", href: "/orders", icon: PackageCheck },
      { label: "Payments", href: "/orders/payments", icon: CreditCard }
    ]
  },
  {
    title: "Partner Registration",
    items: [
      { label: "Projects", href: "/partners", icon: HandCoins },
      { label: "KYC Approvals", href: "/kyc", icon: ShieldCheck },
      { label: "Community", href: "/community", icon: MessageSquareText },
      { label: "Community Reports", href: "/community/reports", icon: BookOpen }
    ]
  }
];

const mobileItems = [
  { label: "Home", href: "/dashboard", icon: LayoutDashboard },
  { label: "Sale", href: "/sale", icon: Store },
  { label: "KYC", href: "/kyc", icon: ShieldCheck },
  { label: "API", href: "/api-viewer", icon: ScrollText }
];

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

        {sections.map((section) => (
          <nav className="nav-group" key={section.title}>
            <p className="nav-group-title">{section.title}</p>
            {section.items.map((item) => (
              <Link className="nav-item" href={item.href} key={item.href}>
                <item.icon />
                {item.label}
              </Link>
            ))}
          </nav>
        ))}
      </aside>

      <main className="main">{children}</main>

      <nav className="mobile-nav">
        {mobileItems.map((item) => (
          <Link href={item.href} key={item.href}>
            <item.icon size={18} />
            {item.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
