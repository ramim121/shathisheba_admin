const listRoutes: Record<string, string> = {
  "sale/listings": "/sale",
  "buy/products": "/buy",
  "buy/orders": "/orders",
  "learning/modules": "/learning",
  "partners/projects": "/partners",
  "partners/applications": "/kyc",
  "community/posts": "/community",
  // Resources whose list page lives under a different path than their API name.
  "brands/manufacturers": "/buy/manufacturers",
  "brands/distributors": "/buy/distributors",
  "promotions/codes": "/buy/promotions",
  "promotions/redemptions": "/buy/redemptions",
  "promotions/vouchers": "/buy/vouchers",
  "notifications/outbox": "/notifications/log"
};

export function getListRoute(resource: string) {
  return listRoutes[resource] ?? `/${resource}`;
}
