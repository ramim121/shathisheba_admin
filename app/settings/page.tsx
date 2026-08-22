import { ManagementPage } from "@/components/ManagementPage";
import { allManagementPages } from "@/lib/admin-pages";

// The System > Settings nav entry has pointed at this route all along; until now
// there was nothing here to serve it.
export default function Page() {
  return <ManagementPage {...allManagementPages["settings/app"]} />;
}
