/**
 * Forma del JSONB `companies.theme_config` en Supabase.
 * Portado de panel-viejo/lib/company-theme-types.ts (mismos campos, mismo contrato).
 *
 * El panel solo lee `primaryColor`/`secondaryColor`/etc. para construir CSS variables
 * via `buildTenantThemeCss`. Los demas campos (`panelAccess`, `tabLabels`, etc.)
 * se mantienen en el tipo para que el SELECT pueda traer el JSONB completo
 * sin perder informacion para futuros pasos.
 */
export type DatabaseCompanyTheme = {
	displayName?: string;
	logoUrl?: string | null;
	primaryColor?: string;
	secondaryColor?: string;
	priceColor?: string;
	discountColor?: string;
	hoverColor?: string;
	backgroundColor?: string;
	backgroundImageUrl?: string | null;
	/** Fuente de verdad de permisos del panel admin a nivel empresa. */
	panelAccess?: string[];
	/** Legacy por rol; se mantiene solo para transicion de datos. */
	roleNavPermissions?: Record<string, string[]>;
	/** Etiquetas por id de pestaña. */
	tabLabels?: Record<string, string>;
	/** Whitelist: ids `tab_id` de `saas_admin_modules` visibles para esta empresa. */
	enabledAdminModuleTabIds?: string[];
	enableSupportTab?: boolean;
	adminShortcutsEnabled?: boolean;
	/** Bloque menu publico / carrusel. */
	menuCarousel?: unknown;
	[key: string]: unknown;
};
