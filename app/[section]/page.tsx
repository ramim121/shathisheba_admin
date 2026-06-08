import { notFound } from "next/navigation";
import { ManagementPage } from "@/components/ManagementPage";
import { pages } from "@/lib/admin-pages";

type Props = {
  params: Promise<{ section: string }>;
};

// `community` has a dedicated route (app/community/page.tsx) — exclude it here
// so the two routes never resolve to the same path.
export function generateStaticParams() {
  return Object.keys(pages)
    .filter((section) => section !== "community")
    .map((section) => ({ section }));
}

export default async function Page({ params }: Props) {
  const { section } = await params;
  const config = section === "community" ? undefined : pages[section];

  if (!config) {
    notFound();
  }

  return <ManagementPage {...config} />;
}
