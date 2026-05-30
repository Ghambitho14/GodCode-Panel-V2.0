import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app";

function mountApp() {
  let container = document.getElementById("app");
  // Fallback defensivo: si el host HTML no provee #app, lo creamos.
  // Esto blinda el entry frente a HTMLs cacheados o variantes del shell.
  if (!container) {
    console.warn("[GodCode] #app no encontrado, creando contenedor fallback.");
    container = document.createElement("div");
    container.id = "app";
    document.body.appendChild(container);
  }
  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", mountApp, { once: true });
} else {
  mountApp();
}
