/** Fallback del `<link rel="icon">` en `index.html` (public/logo.png). */
export const DEFAULT_FAVICON_HREF = "/logo.png";

/**
 * URLs remotas permitidas para favicon (alineado a `resolveSafeLogoUrl` en tickets).
 */
export function getSafeFaviconUrl(logoUrl: string | null | undefined): string | null {
	if (logoUrl == null || !String(logoUrl).trim()) return null;
	try {
		const parsed = new URL(logoUrl, window.location.origin);
		if (parsed.protocol === "https:") return parsed.href;
		if (import.meta.env.DEV && parsed.protocol === "http:") return parsed.href;
		return null;
	} catch {
		return null;
	}
}

function faviconMimeType(href: string): string {
	const path = href.split("?")[0].toLowerCase();
	if (path.endsWith(".svg")) return "image/svg+xml";
	if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "image/jpeg";
	if (path.endsWith(".webp")) return "image/webp";
	return "image/png";
}

/**
 * Actualiza el icono de la pestaña. Si `logoUrl` es inválido o vacío, usa `DEFAULT_FAVICON_HREF`.
 */
export function applyDocumentFavicon(logoUrl: string | null | undefined): void {
	if (typeof document === "undefined") return;
	const safe = getSafeFaviconUrl(logoUrl);
	const href = safe ?? DEFAULT_FAVICON_HREF;

	let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
	if (!link) {
		link = document.createElement("link");
		link.rel = "icon";
		document.head.appendChild(link);
	}
	link.type = faviconMimeType(href);
	link.href = href;
}
