/**
 * Nombres de tablas de Supabase usados en la app.
 * Inmutable para evitar mutaciones accidentales.
 */
export const TABLES = Object.freeze({
  companies: "companies",
  branches: "branches",
  categories: "categories",
  category_branch: "category_branch",
  products: "products",
  product_prices: "product_prices",
  product_branch: "product_branch",
  orders: "orders",
  clients: "clients",
  users: "users",
  cash_shifts: "cash_shifts",
  cash_movements: "cash_movements",
  admin_users: "admin_users",
  inventory_items: "inventory_items",
  inventory_branch: "inventory_branch",
  inventory_movements: "inventory_movements",
  product_inventory_recipe: "product_inventory_recipe",
  hero_banners: "hero_banners",
  discount_coupons: "discount_coupons",
  discount_coupon_redemptions: "discount_coupon_redemptions",
});
