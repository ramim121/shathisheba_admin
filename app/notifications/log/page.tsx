import { ManagementPage } from "@/components/ManagementPage";
import { NotificationStatusBanner } from "@/components/NotificationStatusBanner";
import { nestedPages } from "@/lib/admin-pages";

// The banner explains the most common question about this table: why emails
// sit as "queued" and never go out.
export default function Page() {
  return <ManagementPage {...nestedPages["notifications/outbox"]} banner={<NotificationStatusBanner compact />} />;
}
