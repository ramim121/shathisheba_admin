import { AdminShell } from "@/components/AdminShell";
import { ListingWorkflow } from "@/components/ListingWorkflow";

type Props = {
  params: Promise<{ id: string }>;
};

// One screen per listing: its facts, the price rule it is attached to, and the
// sections the console records — field verification, vaccination, animal
// profile, contract, shipping, payment. There is no approval step; the status
// follows from what has been saved, and Cancel/Reject close the listing.
export default async function SaleDetailPage({ params }: Props) {
  const { id } = await params;
  return (
    <AdminShell>
      <ListingWorkflow listingId={id} />
    </AdminShell>
  );
}
