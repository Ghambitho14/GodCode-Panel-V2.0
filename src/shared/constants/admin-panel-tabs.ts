/**
 * Fuente de verdad para ids de pestañas del panel admin (GodCode Caja).
 * Contrato con Supabase (`public.companies.theme_config`): `panelAccess`, `roleNavPermissions`.
 */

export const ADMIN_PANEL_PRIVILEGED_NAV_ROLES = ["owner", "admin", "ceo"] as const;

export const ADMIN_PANEL_TAB_OPTIONS = [
  { id: "orders", label: "Cocina / Pedidos" },
  { id: "caja", label: "Caja" },
  { id: "analytics", label: "Reportes" },
  { id: "local_expenses", label: "Gastos del local" },
  { id: "categories", label: "Categorías" },
  /** Catálogo vendible (platos); no confundir con la pestaña `inventory` (insumos / stock). */
  { id: "products", label: "Menú y carta" },
  { id: "inventory", label: "Inventario (insumos)" },
  { id: "menu_beverages", label: "Bebidas" },
  { id: "menu_extras", label: "Extras" },
  { id: "menu_options", label: "Opciones de sucursal" },
  { id: "clients", label: "Clientes" },
  { id: "coupons", label: "Cupones" },
] as const;

export const ADMIN_PANEL_TAB_IDS = ADMIN_PANEL_TAB_OPTIONS.map((t) => t.id);

export type AdminPanelTabId = (typeof ADMIN_PANEL_TAB_OPTIONS)[number]["id"];

const ALL_TABS = ADMIN_PANEL_TAB_IDS as unknown as string[];

export const DEFAULT_ROLE_NAV_PERMISSIONS: Record<string, string[]> = {
  owner: [...ALL_TABS],
  admin: [...ALL_TABS],
  ceo: [...ALL_TABS],
  cashier: ["orders", "caja", "local_expenses"],
};

export function getDefaultRoleNavPermissions(): Record<string, string[]> {
  return { ...DEFAULT_ROLE_NAV_PERMISSIONS };
}

/** Alinea el rol de `public.users` con las claves de permisos del panel. */
export function normalizePanelUserRole(role: string | null | undefined): string | null {
  const r = String(role ?? "").trim().toLowerCase();
  if (!r) return null;
  return r === "staff" ? "cashier" : r;
}

const STORED_TAB_ID_ALIASES: Record<string, string> = {
  admin_menu_options: "menu_options",
  bebidas: "menu_beverages",
  beverages: "menu_beverages",
  cart_beverages: "menu_beverages",
  global_extras: "menu_extras",
  extras: "menu_extras",
  cart_extras: "menu_extras",
};

/** Normaliza un id leído de configuración legacy antes de validar contra ADMIN_PANEL_TAB_IDS. */
export function normalizeStoredNavTabId(tabId: string): string {
  const t = String(tabId ?? "").trim();
  if (!t) return t;
  return STORED_TAB_ID_ALIASES[t] ?? t;
}

/** Labels base (español) por id + overrides desde `theme_config.tabLabels`. */
export function buildResolvedTabLabels(tabLabelsFromTheme?: Record<string, string> | null): Record<string, string> {
  const base: Record<string, string> = {};
  for (const t of ADMIN_PANEL_TAB_OPTIONS) {
    base[t.id] = t.label;
  }
  if (tabLabelsFromTheme && typeof tabLabelsFromTheme === "object") {
    for (const [k, v] of Object.entries(tabLabelsFromTheme)) {
      if (typeof v === "string" && v.trim()) {
        base[String(k).trim()] = v.trim();
      }
    }
  }
  return base;
}

export function getCashierDefaultAllowedTabIds(): string[] {
  return [...DEFAULT_ROLE_NAV_PERMISSIONS.cashier];
}
