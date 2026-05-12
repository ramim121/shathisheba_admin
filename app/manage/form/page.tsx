import { notFound } from "next/navigation";
import { ResourceFormPage } from "@/components/ResourceFormPage";
import { allManagementPages } from "@/lib/admin-pages";

type Props = {
  searchParams: Promise<{ resource?: string; id?: string }>;
};

export default async function Page({ searchParams }: Props) {
  const { resource, id } = await searchParams;
  if (!resource || !allManagementPages[resource]) notFound();
  return <ResourceFormPage config={allManagementPages[resource]} resource={resource} id={id} />;
}
