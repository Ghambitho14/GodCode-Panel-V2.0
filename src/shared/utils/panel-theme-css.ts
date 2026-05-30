import type { DatabaseCompanyTheme } from "@/shared/types/company-theme";

/**
 * Construye un bloque CSS con variables del tenant (`.tenant-theme-vars { ... }`).
 * Portado de panel-viejo/lib/panel-theme-css.ts (mismo contrato y mismos fallbacks).
 *
 * Uso esperado:
 *   <style>{buildTenantThemeCss({ theme_config })}</style>
 *   <div className="tenant-theme-vars"> ... </div>
 *
 * Si `theme_config` es null o le faltan campos, cada token cae a su default
 * y la UI sigue viendose como hoy (no rompe nada).
 */

const toRgba = (hex: string, alpha: number, fallback: string) => {
	if (!hex) return fallback;
	const normalized = hex.trim();
	const shortMatch = /^#([a-fA-F0-9]{3})$/.exec(normalized);
	const longMatch = /^#([a-fA-F0-9]{6})$/.exec(normalized);
	const hexValue = shortMatch
		? shortMatch[1]
				.split("")
				.map((char) => char + char)
				.join("")
		: longMatch
			? longMatch[1]
			: null;
	if (!hexValue) return fallback;
	const r = Number.parseInt(hexValue.slice(0, 2), 16);
	const g = Number.parseInt(hexValue.slice(2, 4), 16);
	const b = Number.parseInt(hexValue.slice(4, 6), 16);
	return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

const sanitizeCssValue = (value: string) => value.replace(/<|>|"|'|`/g, "").trim();

type CompanyRow = {
	theme_config?: DatabaseCompanyTheme | null;
};

export function buildTenantThemeCss(company: CompanyRow | null): string {
	const primaryColor = company?.theme_config?.primaryColor ?? "#111827";
	const secondaryColor = company?.theme_config?.secondaryColor ?? primaryColor;
	const priceColor = company?.theme_config?.priceColor ?? "#ff4757";
	const discountColor = company?.theme_config?.discountColor ?? "#25d366";
	const hoverColor = company?.theme_config?.hoverColor ?? "#ff2e40";
	const accentShadow = toRgba(primaryColor, 0.3, "rgba(255, 71, 87, 0.3)");
	const accentShadowStrong = toRgba(primaryColor, 0.5, "rgba(255, 71, 87, 0.5)");
	const cardBorder = toRgba(primaryColor, 0.18, "rgba(255, 255, 255, 0.1)");
	const backgroundColor = company?.theme_config?.backgroundColor ?? "#0a0a0a";
	const backgroundImageUrl =
		company?.theme_config?.backgroundImageUrl ?? "/tenant/menu-pattern.webp";
	const backgroundImage = backgroundImageUrl
		? `url(${backgroundImageUrl}), url(/tenant/menu-pattern.webp)`
		: "url(/tenant/menu-pattern.webp)";
	return `.tenant-theme-vars{--tenant-primary:${sanitizeCssValue(primaryColor)};--accent-primary:${sanitizeCssValue(primaryColor)};--accent-secondary:${sanitizeCssValue(secondaryColor)};--price-color:${sanitizeCssValue(priceColor)};--discount-color:${sanitizeCssValue(discountColor)};--accent-hover:${sanitizeCssValue(hoverColor)};--accent-shadow:${sanitizeCssValue(accentShadow)};--accent-shadow-strong:${sanitizeCssValue(accentShadowStrong)};--card-border:${sanitizeCssValue(cardBorder)};--bg-primary:${sanitizeCssValue(backgroundColor)};--tenant-bg-image:${sanitizeCssValue(backgroundImage)};}`;
}
