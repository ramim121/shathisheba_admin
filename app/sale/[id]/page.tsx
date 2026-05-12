import Link from "next/link";
import { ArrowLeft, CheckCircle2, Edit3, MapPin, Scale, ShieldCheck, UserRound } from "lucide-react";
import { AdminShell } from "@/components/AdminShell";
import { Status } from "@/components/Status";
import { getSaleListingDetail } from "@/lib/db-resources";

type Props = {
  params: Promise<{ id: string }>;
};

function value(input: unknown) {
  if (input === null || input === undefined || input === "") return "-";
  return String(input);
}

export default async function SaleDetailPage({ params }: Props) {
  const { id } = await params;
  const listing = await getSaleListingDetail(id);

  if (!listing) {
    return (
      <AdminShell>
        <div className="panel empty-state">
          <h1>Sale listing not found</h1>
          <p>No sale listing exists for id {id}.</p>
          <Link className="btn primary" href="/sale">Back to listings</Link>
        </div>
      </AdminShell>
    );
  }

  return (
    <AdminShell>
      <section className="detail-hero">
        <div>
          <Link className="back-link" href="/sale"><ArrowLeft size={18} /> Sale listings</Link>
          <p className="eyeline">Sale Listing Detail</p>
          <h1 className="page-title">{value(listing.title_en)}</h1>
          <p className="subtitle">{value(listing.category_name)} / {value(listing.item_name)} / {value(listing.breed_name)}</p>
        </div>
        <div className="detail-actions">
          <Status label={value(listing.status)} />
          <button className="btn ghost" type="button"><Edit3 size={18} /> Edit</button>
          <button className="btn primary" type="button"><CheckCircle2 size={18} /> Approve</button>
        </div>
      </section>

      <section className="detail-grid">
        <article className="panel detail-card">
          <div className="detail-icon"><UserRound /></div>
          <span>Farmer</span>
          <strong>{value(listing.farmer_name)}</strong>
          <p>{value(listing.farmer_phone)}</p>
        </article>
        <article className="panel detail-card">
          <div className="detail-icon"><Scale /></div>
          <span>Weight & earning</span>
          <strong>{value(listing.weight_kg)} kg</strong>
          <p>Estimated earning ৳{value(listing.estimated_earning)}</p>
        </article>
        <article className="panel detail-card">
          <div className="detail-icon"><MapPin /></div>
          <span>Location</span>
          <strong>{value(listing.farmer_district)}</strong>
          <p>{value(listing.farmer_upazila)}</p>
        </article>
        <article className="panel detail-card">
          <div className="detail-icon"><ShieldCheck /></div>
          <span>Verification</span>
          <strong>{value(listing.status)}</strong>
          <p>Approved at {value(listing.approved_at)}</p>
        </article>
      </section>

      <section className="dashboard-layout" style={{ marginTop: 18 }}>
        <div className="panel">
          <div className="panel-header">
            <div>
              <h2>Listing Information</h2>
              <p>Operational view of all fields submitted from the app.</p>
            </div>
          </div>
          <div className="definition-list">
            <div><span>Listing code</span><strong>{value(listing.listing_code)}</strong></div>
            <div><span>Bangla title</span><strong>{value(listing.title_bn)}</strong></div>
            <div><span>Age</span><strong>{value(listing.age_months)} months</strong></div>
            <div><span>Quantity</span><strong>{value(listing.quantity)} {value(listing.unit)}</strong></div>
            <div><span>Farmer price</span><strong>৳{value(listing.farmer_expected_price)}</strong></div>
            <div><span>Contact address</span><strong>{value(listing.address_text)}</strong></div>
          </div>
        </div>

        <aside className="panel">
          <div className="panel-header">
            <div>
              <h2>AI & Field Review</h2>
              <p>Photo analysis payload and verification notes.</p>
            </div>
          </div>
          <pre className="json-box">{JSON.stringify(listing.ai_analysis_json ?? {}, null, 2)}</pre>
        </aside>
      </section>
    </AdminShell>
  );
}
