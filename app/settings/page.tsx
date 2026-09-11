import { AdminShell } from "@/components/AdminShell";
import { GeoScopeSettings } from "@/components/GeoScopeSettings";
import { OperationalZones } from "@/components/OperationalZones";

// Settings opens on the geo filters: the switch staff reach for most. The raw
// key/value table moved to Settings > Platform switches.
export default function Page() {
  return (
    <AdminShell>
      <GeoScopeSettings />
      <OperationalZones />
    </AdminShell>
  );
}
