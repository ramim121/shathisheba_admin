"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Info } from "lucide-react";

type Overlap = {
  a_id: string;
  b_id: string;
  a_name: string;
  b_name: string;
  a_area: string;
  b_area: string;
  item: string;
  kind: "conflict" | "nested";
};

/**
 * Active price rules that answer the same quote. A conflict (same scope) is a
 * real problem — the quote falls back to whichever is newer. A nested pair is
 * by design (the specific rule wins its slice) and shown as information.
 */
export function PricingOverlapBanner() {
  const [data, setData] = useState<{ conflicts: Overlap[]; nested: Overlap[] } | null>(null);

  useEffect(() => {
    fetch("/api/v1/admin/sale/pricing/overlaps", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => setData(j?.data ?? null))
      .catch(() => setData(null));
  }, []);

  if (!data) return null;
  const { conflicts, nested } = data;
  if (!conflicts.length && !nested.length) {
    return <div className="overlap-banner ok">No overlapping active price rules — every quote resolves to exactly one rule.</div>;
  }
  return (
    <div className={`overlap-banner ${conflicts.length ? "bad" : "info"}`}>
      {conflicts.length ? (
        <>
          <strong><AlertTriangle size={16} /> {conflicts.length} conflicting rule pair(s)</strong>
          <p>Same item, animal, breed and area on overlapping dates. Only the newer one is used; deactivate or narrow the other.</p>
          <ul>
            {conflicts.map((o) => (
              <li key={`${o.a_id}-${o.b_id}`}>{o.item}: <b>{o.a_name}</b> ({o.a_area}) and <b>{o.b_name}</b> ({o.b_area})</li>
            ))}
          </ul>
        </>
      ) : null}
      {nested.length ? (
        <>
          <strong><Info size={16} /> {nested.length} nested rule pair(s)</strong>
          <p>One rule is more specific than the other; the specific one wins where both apply.</p>
          <ul>
            {nested.map((o) => (
              <li key={`${o.a_id}-${o.b_id}`}>{o.item}: <b>{o.a_name}</b> ({o.a_area}) inside/around <b>{o.b_name}</b> ({o.b_area})</li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}
