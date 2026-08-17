import { ManagementPage } from "@/components/ManagementPage";
import { allManagementPages } from "@/lib/admin-pages";

export default function Page() {
  return <ManagementPage {...allManagementPages["loan/readiness-checks"]} />;
}