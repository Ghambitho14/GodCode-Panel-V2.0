import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertCircle, Eye, EyeOff, Loader2, Lock, Mail } from "lucide-react";
import { bootstrapSession, login } from "@/integrations/supabase";

export function LoginForm() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void bootstrapSession().then((user) => {
      if (!cancelled && user) navigate("/admin", { replace: true });
    });
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (loading) return;
    setError(null);
    setLoading(true);
    try {
      await login(email.trim(), password);
      navigate("/admin", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo iniciar sesion.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className={`login-form ${loading ? "is-loading" : ""}`}>
      {error ? (
        <div className="login-error">
          <AlertCircle size={18} />
          <span>{error}</span>
        </div>
      ) : null}

      <div className="form-group">
        <label>Correo Electrónico</label>
        <div className="input-with-icon">
          <Mail size={18} className="input-icon" />
          <input
            className="form-input"
            type="email"
            autoComplete="username"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="admin@godcode.me"
            required
          />
        </div>
      </div>

      <div className="form-group">
        <label>Contraseña</label>
        <div className="input-with-icon">
          <Lock size={18} className="input-icon" />
          <input
            className="form-input"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="••••••••"
            required
          />
          <button
            type="button"
            className="login-password-toggle"
            onClick={() => setShowPassword((value) => !value)}
            aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
          >
            {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
      </div>

      <button type="submit" className="btn btn-primary login-submit-button" disabled={loading}>
        {loading ? (
          <>
            <Loader2 size={20} className="animate-spin" />
            <span>Entrando...</span>
          </>
        ) : (
          <span>Ingresar</span>
        )}
      </button>
    </form>
  );
}
