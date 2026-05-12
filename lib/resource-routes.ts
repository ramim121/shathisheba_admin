const listRoutes: Record<string, string> = {
  "sale/listings": "/sale",
  "buy/products": "/buy",
  "buy/orders": "/orders",
  "learning/modules": "/learning",
  "partners/projects": "/partners",
  "partners/applications": "/kyc",
  "community/posts": "/community"
};

export function getListRoute(resource: string) {
  return listRoutes[resource] ?? `/${resource}`;
}
