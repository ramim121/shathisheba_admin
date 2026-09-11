import { ManagementPage } from "@/components/ManagementPage";
import { PricingOverlapBanner } from "@/components/PricingOverlapBanner";
import { nestedPages } from "@/lib/admin-pages";

export default function Page() {
  return <ManagementPage {...nestedPages["sale/pricing"]} banner={<PricingOverlapBanner />} />;
}
