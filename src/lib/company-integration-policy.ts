/**
 * Politicas de integracion a nivel empresa.
 * Portado tal cual de panel-viejo/lib/company-integration-policy.ts.
 *
 * `companies.integration_settings` (JSONB) puede llevar `allowTenantExternalDelivery`
 * para que el SaaS bloquee la opcion de envio externo (Uber Direct, etc.) en algunos
 * tenants. Si la clave no existe, se asume permitido (back-compat).
 */
export function isTenantExternalDeliveryAllowed(integrationSettingsRaw: unknown): boolean {
	if (
		!integrationSettingsRaw ||
		typeof integrationSettingsRaw !== "object" ||
		Array.isArray(integrationSettingsRaw)
	) {
		return true;
	}
	const o = integrationSettingsRaw as Record<string, unknown>;
	if (o.allowTenantExternalDelivery === false) return false;
	if (o.allow_tenant_external_delivery === false) return false;
	return true;
}
