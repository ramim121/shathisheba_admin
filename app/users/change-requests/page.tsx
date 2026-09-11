import { AdminShell } from "@/components/AdminShell";
import { ProfileRequestsBoard } from "@/components/ProfileRequestsBoard";

export default function Page() {
  return (
    <AdminShell>
      <ProfileRequestsBoard />
    </AdminShell>
  );
}
