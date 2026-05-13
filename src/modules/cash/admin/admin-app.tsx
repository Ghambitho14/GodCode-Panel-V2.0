import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { supabase, TABLES } from "@/integrations/supabase";
import type { DatabaseCompanyTheme } from "@/shared/types/company-theme";
import { buildTenantThemeCss } from "@/shared/utils/panel-theme-css";
import "../styles/AdminContextualHelp.css";
import { AdminPage } from "./pages/Admin";
import { AdminProvider } from "./pages/AdminProvider";
import { LocationProvider } from "../context/LocationContext";
import { CashProvider } from "../context/CashContext";
import { BusinessProvider } from "../context/BusinessContext";
import { applyDocumentFavicon } from "@/shared/utils/documentFavicon";

interface AdminAppProps {
	/** Opcional: forzar empresa (solo si necesitás override explícito; por defecto se toma de la sesión). */
	companyId?: string;
	companyName?: string;
	logoUrl?: string | null;
	userEmail?: string | null;
	initialUserRole?: string | null;
	panelAccess?: string[] | null;
	dynamicModules?: {
		id: string;
		tabId: string;
		label: string;
		description: string;
		navGroup: "root" | "sales" | "menu";
		navOrder: number;
		allowedRoles: string[];
		isActive: boolean;
	}[];
	primaryColor?: string;
	storefrontMenuUrl?: string | null;
	resolvedTabLabels?: Record<string, string>;
	adminShortcutsEnabled?: boolean;
}

export function AdminApp({
	companyId: companyIdProp,
	companyName: companyNameProp = "Panel",
	logoUrl: logoUrlProp,
	userEmail: userEmailProp,
	initialUserRole = null,
	panelAccess,
	dynamicModules = [],
	primaryColor,
	storefrontMenuUrl = null,
	resolvedTabLabels = {},
	adminShortcutsEnabled = true,
}: AdminAppProps) {
	const navigate = useNavigate();
	const [resolvedCompanyId, setResolvedCompanyId] = useState<string | null>(() =>
		companyIdProp?.trim() ? companyIdProp.trim() : null,
	);
	const [resolvedCompanyName, setResolvedCompanyName] = useState(companyNameProp);
	const [resolvedUserEmail, setResolvedUserEmail] = useState<string | null>(userEmailProp ?? null);
	const [resolvedThemeConfig, setResolvedThemeConfig] = useState<DatabaseCompanyTheme | null>(null);
	const [gateLoading, setGateLoading] = useState(() => !companyIdProp?.trim());

	useEffect(() => {
		let cancelled = false;

		if (companyIdProp?.trim()) {
			const cid = companyIdProp.trim();
			setResolvedCompanyId(cid);
			setGateLoading(false);
			void supabase.auth.getSession().then(({ data: { session } }) => {
				if (cancelled) return;
				const em = session?.user?.email?.trim().toLowerCase() ?? null;
				setResolvedUserEmail(em);
			});
			void supabase
				.from(TABLES.companies)
				.select("theme_config")
				.eq("id", cid)
				.maybeSingle()
				.then(({ data: co }) => {
					if (cancelled) return;
					setResolvedThemeConfig((co?.theme_config as DatabaseCompanyTheme) ?? null);
				});
			return () => {
				cancelled = true;
			};
		}

		(async () => {
			const {
				data: { session },
			} = await supabase.auth.getSession();
			if (!session) {
				navigate("/", { replace: true });
				return;
			}
			const uid = session.user.id;
			const emailNorm = session.user.email?.trim().toLowerCase() ?? "";

			let { data: row } = await supabase
				.from(TABLES.users)
				.select("company_id")
				.eq("auth_user_id", uid)
				.maybeSingle();

			if (!row?.company_id && emailNorm) {
				const r2 = await supabase
					.from(TABLES.users)
					.select("company_id")
					.ilike("email", emailNorm)
					.maybeSingle();
				row = r2.data;
			}

			if (cancelled) return;

			if (!row?.company_id) {
				await supabase.auth.signOut();
				navigate("/", { replace: true });
				return;
			}

			const cid = String(row.company_id);

			const { data: co } = await supabase
				.from(TABLES.companies)
				.select("name, theme_config")
				.eq("id", cid)
				.maybeSingle();

			if (cancelled) return;

			setResolvedCompanyId(cid);
			if (co?.name) setResolvedCompanyName(co.name);
			setResolvedThemeConfig((co?.theme_config as DatabaseCompanyTheme) ?? null);
			setResolvedUserEmail(emailNorm || null);
			setGateLoading(false);
		})();

		return () => {
			cancelled = true;
		};
	}, [companyIdProp, navigate]);

	// El logo del negocio vive en `companies.theme_config.logoUrl` (Cloudinary).
	// El prop `logoUrlProp` sigue ganando si el caller lo provee explicitamente.
	const themeLogoUrl = useMemo(() => {
		return typeof resolvedThemeConfig?.logoUrl === "string" && resolvedThemeConfig.logoUrl.trim()
			? resolvedThemeConfig.logoUrl.trim()
			: null;
	}, [resolvedThemeConfig]);
	const effectiveLogoUrl = logoUrlProp ?? themeLogoUrl;

	useEffect(() => {
		if (gateLoading || !resolvedCompanyId) return;
		applyDocumentFavicon(effectiveLogoUrl);
		return () => {
			applyDocumentFavicon(null);
		};
	}, [effectiveLogoUrl, gateLoading, resolvedCompanyId]);

	if (gateLoading || !resolvedCompanyId) {
		return (
			<div
				className="admin-gate-loading"
				style={{
					display: "flex",
					alignItems: "center",
					justifyContent: "center",
					minHeight: "40vh",
					gap: 10,
				}}
			>
				<Loader2 className="animate-spin" size={22} aria-hidden />
				<span>Cargando tu cuenta...</span>
			</div>
		);
	}

	return (
		<>
			<style>{buildTenantThemeCss({ theme_config: resolvedThemeConfig })}</style>
			<div className="tenant-theme-vars">
				<LocationProvider companyId={resolvedCompanyId}>
					<CashProvider>
						<BusinessProvider>
							<AdminProvider
								companyId={resolvedCompanyId}
								initialUserRole={initialUserRole}
								panelAccess={panelAccess}
								dynamicModules={dynamicModules}
								resolvedTabLabels={resolvedTabLabels}
								adminShortcutsEnabled={adminShortcutsEnabled}
							>
								<AdminPage
									companyName={resolvedCompanyName}
									logoUrl={effectiveLogoUrl}
									userEmail={resolvedUserEmail ?? userEmailProp}
									primaryColor={primaryColor}
									storefrontMenuUrl={storefrontMenuUrl}
								/>
							</AdminProvider>
						</BusinessProvider>
					</CashProvider>
				</LocationProvider>
			</div>
		</>
	);
}
