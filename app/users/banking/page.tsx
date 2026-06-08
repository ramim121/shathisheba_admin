import { ManagementPage } from "@/components/ManagementPage";
import { nestedPages } from "@/lib/admin-pages";

export default function Page() {
  return <ManagementPage {...nestedPages["app/user-banking"]} />;
}
