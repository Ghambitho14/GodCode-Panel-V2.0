import { Building2, Lock, ShieldCheck } from "lucide-react";
import { LoginForm } from "./login-form";

interface LoginShellProps {
  displayName: string;
}

export function LoginShell({ displayName }: LoginShellProps) {
  return (
    <main className="login-shell">
      <div className="login-card glass animate-fade">
        <aside className="login-aside">
          <div className="login-aside-brand">
            <div className="login-icon-circle">
              <Building2 size={30} />
            </div>
            <h1 className="login-brand-title">{displayName}</h1>
            <p className="login-brand-subtitle">Gestión de pedidos, productos, caja y operación diaria.</p>
          </div>

          <ul className="login-benefits" aria-label="Beneficios del panel">
            <li>
              <ShieldCheck size={16} />
              <span>Acceso seguro por roles</span>
            </li>
            <li>
              <Lock size={16} />
              <span>Sesión protegida por Supabase Auth</span>
            </li>
          </ul>
        </aside>

        <section className="login-main">
          <div className="login-content-stack">
            <header className="login-header">
              <h2 className="section-title login-title">Acceso Admin</h2>
              <p className="login-subtitle">Ingresa con tu cuenta autorizada para este local.</p>
            </header>
            <div className="login-actions-stack">
              <LoginForm />
            </div>
            <p className="login-help-text">¿Problemas para ingresar? Contacta al administrador de la empresa.</p>
          </div>
        </section>
      </div>
    </main>
  );
}
