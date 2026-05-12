import { notFound } from "next/navigation";
import { ManagementPage } from "@/components/ManagementPage";
import { pages } from "@/lib/admin-pages";

type Props = {
  params: Promise<{ section: string }>;
};

export function generateStaticParams() {
  return Object.keys(pages).map((section) => ({ section }));
}

export default async function Page({ params }: Props) {
  const { section } = await params;
  const config = pages[section];

  if (!config) {
    notFound();
  }

  return <ManagementPage {...config} />;
}
