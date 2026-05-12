import { useState } from "react";
import { LoginForm } from "./login-form";

interface LoginShellProps {
  displayName: string;
}

type AccessMode = "caja" | "admin";

export function LoginShell({ displayName }: LoginShellProps) {
  const [accessMode, setAccessMode] = useState<AccessMode>("caja");

  const panelCopy =
    accessMode === "caja"
      ? {
          heading: "¿Administración?",
          line: "Configura el local, reportes y permisos avanzados.",
          action: "admin" as const,
          buttonLabel: "Acceso admin",
        }
      : {
          heading: "¿Operación de caja?",
          line: "Cobros, turnos y uso diario del panel en este equipo.",
          action: "caja" as const,
          buttonLabel: "Acceso caja",
        };

  return (
    <main className="login-shell login-shell--split" data-mode={accessMode}>
      <div className="login-slide-card glass animate-fade" data-mode={accessMode}>
        <p className="login-slide-brand">{displayName}</p>

        <div className="login-slide-forms" aria-live="polite">
          <div className="login-form-plate">
            <header className="login-slide-form-header">
              <h2 className="login-slide-title">
                {accessMode === "caja" ? "Acceso caja" : "Acceso admin"}
              </h2>
              <p className="login-slide-subtitle">
                {accessMode === "caja"
                  ? "Ingresa con tu cuenta para operar caja en este local."
                  : "Continúa en el portal web de GodCode para acceder al panel de administración."}
              </p>
            </header>
            <div className="login-slide-actions">
              {accessMode === "caja" ? (
                <LoginForm />
              ) : (
                <p className="login-admin-external-wrap">
                  <a
                    className="btn btn-primary login-submit-button login-admin-external-link"
                    href="https://www.godcode.me/login"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Acceso GodCode (web)
                  </a>
                </p>
              )}
            </div>
            <p className="login-slide-help">
              ¿Problemas para ingresar? Contacta al administrador de la empresa.
            </p>
          </div>
        </div>

        <aside className="login-sliding-panel" aria-label="Cambiar tipo de acceso">
          <div className="login-sliding-panel__inner">
            <div className="login-sliding-panel__deco" aria-hidden />
            <h3 className="login-sliding-panel__title">{panelCopy.heading}</h3>
            <p className="login-sliding-panel__text">{panelCopy.line}</p>
            <button
              type="button"
              className="login-sliding-panel__btn"
              onClick={() => setAccessMode(panelCopy.action)}
            >
              {panelCopy.buttonLabel}
            </button>
          </div>
        </aside>
      </div>
    </main>
  );
}
