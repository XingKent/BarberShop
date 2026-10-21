import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth";
import AuthPanel from "../components/AuthPanel";

/** Só aceita caminhos internos do site (evita redirecionar para outro endereço). */
function safeNext(value: string | null): string {
  return value && /^\/(?!\/)/.test(value) ? value : "/conta";
}

export default function Login() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const next = safeNext(params.get("next"));

  // Quem já está logado não precisa ver a tela de entrada.
  useEffect(() => {
    if (!loading && user?.role === "CLIENT") navigate(next, { replace: true });
  }, [loading, user, next, navigate]);

  return (
    <div className="stack" style={{ paddingTop: "0.75rem" }}>
      <h1>Sua conta</h1>
      <p className="muted">Com a conta, você agenda mais rápido e vê seus horários em um só lugar.</p>
      <AuthPanel
        initialMode={params.get("criar") ? "register" : "login"}
        onDone={() => navigate(next, { replace: true })}
      />
    </div>
  );
}
