import { AdminShell } from "@/components/AdminShell";
import { ListingWorkflow } from "@/components/ListingWorkflow";

type Props = {
  params: Promise<{ id: string }>;
};

// One screen per listing: its facts, the price rule it is attached to, and the
// six steps from submission to the farmer being paid.
export default async function SaleDetailPage({ params }: Props) {
  const { id } = await params;
  return (
    <AdminShell>
      <ListingWorkflow listingId={id} />
    </AdminShell>
  );
}
