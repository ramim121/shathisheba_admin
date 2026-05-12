export function Status({ label }: { label: string }) {
  const lower = label.toLowerCase();
  const color = lower.includes("active") || lower.includes("paid") || lower.includes("ready") || lower.includes("visible") || lower.includes("published") || lower.includes("stock")
    ? "green"
    : lower.includes("pending") || lower.includes("soon") || lower.includes("watch") || lower.includes("verification") || lower.includes("draft")
      ? "gold"
      : lower.includes("review") || lower.includes("moderation") || lower.includes("document") || lower.includes("low")
        ? "red"
        : "rose";

  return <span className={`status-pill ${color}`}>{label}</span>;
}
