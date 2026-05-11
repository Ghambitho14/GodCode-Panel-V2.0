import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./modules/cash/app-shell";
import { AdminApp } from "./modules/cash/admin/admin-app";
import { LoginShell } from "./modules/auth/login-shell";

import "./modules/cash/styles/AdminLayout.css";
import "./modules/cash/styles/index.css";
import "./modules/cash/styles/AdminShared.css";
import "./modules/cash/styles/AdminSidebar.css";
import "./modules/cash/styles/AdminAnalytics.css";
import "./modules/cash/styles/AdminClients.css";
import "./modules/cash/styles/AdminClientsTable.css";
import "./modules/cash/styles/AdminCategories.css";
import "./modules/cash/styles/AdminCoupons.css";
import "./modules/cash/styles/AdminInventory.css";
import "./modules/cash/styles/AdminKanban.css";
import "./modules/cash/styles/AdminSettings.css";
import "./modules/cash/styles/ManualOrderModal.css";
import "./modules/cash/styles/Modals.css";
import "./modules/cash/styles/OrderCard.css";
import "./modules/cash/styles/ProductModal.css";
import "./modules/cash/styles/CategoryModal.css";
import "./modules/cash/styles/InventoryCard.css";
import "./modules/cash/styles/AdminContextualHelp.css";
import "./modules/cash/styles/AdminMenuCarousel.css";
import "./modules/cash/styles/AdminMenuOptions.css";
import "./modules/cash/styles/TenantTicketsPanel.css";
import "./modules/cash/styles/CashSystem.css";
import "./modules/cash/styles/Login.css";
import "./modules/cash/styles/App.css";

/**
 * Tabs "extras" del admin que el panel viejo cargaba desde `saas_admin_modules`
 * (tabla del SaaS hoy vacia). El panel viejo tambien inyectaba "Soporte" por
 * codigo cuando faltaba; replicamos ese comportamiento aqui hasta que decidamos
 * (Fase 2) si exponemos `saas_admin_modules` directamente o no.
 *
 * El consumo lo hace `AdminProvider` (filtra por `allowedRoles` del usuario).
 */
const DEFAULT_DYNAMIC_MODULES = [
  {
    id: "system-module-tickets",
    tabId: "module:tickets",
    label: "Soporte",
    description: "Crea y da seguimiento a tickets de soporte.",
    navGroup: "root" as const,
    navOrder: 85,
    allowedRoles: ["owner", "admin", "ceo", "cashier", "staff"],
    isActive: true,
  },
];

export function App() {
  return (
    <BrowserRouter>
      <AppShell>
        <Routes>
          <Route path="/" element={<LoginShell displayName="GodCode Caja" />} />
          <Route
            path="/admin"
            element={
              <AdminApp
                companyName="GodCode Caja"
                dynamicModules={DEFAULT_DYNAMIC_MODULES}
              />
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AppShell>
    </BrowserRouter>
  );
}
