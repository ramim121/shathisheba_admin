import { notFound } from "next/navigation";
import { ResourceDetailPage } from "@/components/ResourceDetailPage";
import { allManagementPages } from "@/lib/admin-pages";

type Props = {
  searchParams: Promise<{ resource?: string; id?: string }>;
};

export default async function Page({ searchParams }: Props) {
  const { resource, id } = await searchParams;
  if (!resource || !id || !allManagementPages[resource]) notFound();
  return <ResourceDetailPage config={allManagementPages[resource]} resource={resource} id={id} />;
}
