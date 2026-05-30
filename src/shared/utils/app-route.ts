/**
 * Resuelve rutas internas para la app de caja (sin prefijos multi-tenant / subdominio).
 */
export function getAppScopedPath(_currentPath: string, path: string): string {
  if (!path) return "/";
  return path.startsWith("/") ? path : `/${path}`;
}
