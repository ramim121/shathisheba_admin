"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Bell } from "lucide-react";

export function NotificationBell() {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const res = await fetch("/api/v1/app/admin/notifications", { cache: "no-store" });
        const json = await res.json();
        if (alive && json.ok) setCount(json.data.counts.total);
      } catch {
        /* ignore */
      }
    }
    void load();
    const timer = setInterval(load, 60000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  return (
    <Link className="notif-bell" href="/notifications" title="Notifications">
      <Bell size={18} />
      <span>Notifications</span>
      {count && count > 0 ? <em className="notif-badge">{count > 99 ? "99+" : count}</em> : null}
    </Link>
  );
}
