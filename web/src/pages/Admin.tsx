import { useState } from "react";
import { Link, NavLink, Route, Routes } from "react-router-dom";
import { ApiError, auth } from "../api";
import { useAuth } from "../auth";
import { PublicLayout } from "../components/Layout";
import Qr from "../components/Qr";
import { SHOP_NAME } from "../format";
import Agenda from "./admin/Agenda";
import Catalog from "./admin/Catalog";
import Clients from "./admin/Clients";
import Revenue from "./admin/Revenue";
import { AdminCtx } from "./admin/util";

type Stage = "credentials" | "totp" | "setup";

/** Entrada do dono: e-mail e senha, depois o código do aplicativo autenticador. */
function OwnerLogin() {
  const { refresh } = useAuth();
  const [stage, setStage] = useState<Stage>("credentials");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [setup, setSetup] = useState<{ secret: string; uri: string }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Algo deu errado. Tente de novo.");
    } finally {
      setBusy(false);
    }
  }

  const submitLogin = (e: React.FormEvent) => {
    e.preventDefault();
    void run(async () => {
      try {
        const r = await auth.ownerLogin({
          email: email.trim(),
          password,
          ...(stage === "totp" ? { totp: code.trim() } : {}),
        });
        if (r.needsTotpSetup) {
          setSetup(await auth.totpSetup());
          setCode("");
          setStage("setup");
          return;
        }
        await refresh();
      } catch (err) {
        if (err instanceof ApiError && err.code === "TOTP_REQUIRED") {
          setCode("");
          setStage("totp");
          return;
        }
        throw err;
      }
    });
  };

  const submitSetup = (e: React.FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await auth.totpEnable(code.trim());
      await refresh();
    });
  };

  return (
    <PublicLayout>
      <div className="stack" style={{ paddingTop: "0.75rem" }}>
        <h1>Área da barbearia</h1>

        {error && (
          <p className="alert" role="alert">
            {error}
          </p>
        )}

        {stage !== "setup" && (
          <form className="stack" onSubmit={submitLogin}>
            <p className="muted">
              {stage === "credentials"
                ? "Entre com o e-mail e a senha do dono."
                : "Digite o código de 6 números que aparece no aplicativo autenticador."}
            </p>
            {stage === "credentials" && (
              <>
                <label className="field">
                  <span>E-mail</span>
                  <input
                    className="input"
                    type="email"
                    autoComplete="username"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </label>
                <label className="field">
                  <span>Senha</span>
                  <input
                    className="input"
                    type="password"
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </label>
              </>
            )}
            {stage === "totp" && (
              <label className="field">
                <span>Código do autenticador</span>
                <input
                  className="input code-input"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  required
                  autoFocus
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                />
              </label>
            )}
            <button className="btn" type="submit" disabled={busy || (stage === "totp" && code.length !== 6)}>
              {busy ? "Entrando…" : stage === "totp" ? "Confirmar e entrar" : "Entrar"}
            </button>
            {stage === "totp" && (
              <button
                className="linkbtn"
                type="button"
                onClick={() => {
                  setStage("credentials");
                  setCode("");
                  setError("");
                }}
              >
                Voltar
              </button>
            )}
          </form>
        )}

        {stage === "setup" && setup && (
          <form className="stack" onSubmit={submitSetup}>
            <h2>Ative a verificação em duas etapas</h2>
            <p className="muted">
              O painel mostra faturamento e dados de clientes, então a entrada pede um segundo código.
              Você faz isto uma vez só.
            </p>
            <ol className="steps">
              <li>
                Instale um aplicativo autenticador no celular (Google Authenticator, Microsoft
                Authenticator ou Authy).
              </li>
              <li>Adicione uma conta e aponte a câmera para o código abaixo.</li>
              <li>Digite aqui o código de 6 números que o aplicativo mostrar.</li>
            </ol>
            <Qr value={setup.uri} label="Código QR para o aplicativo autenticador" />
            <p className="muted small">
              Sem câmera? Digite esta chave no aplicativo: <code className="secret">{setup.secret}</code>
            </p>
            <label className="field">
              <span>Código de 6 números</span>
              <input
                className="input code-input"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                required
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              />
            </label>
            <button className="btn" type="submit" disabled={busy || code.length !== 6}>
              {busy ? "Ativando…" : "Ativar e entrar"}
            </button>
          </form>
        )}
      </div>
    </PublicLayout>
  );
}

export default function Admin() {
  const { user, loading, logout } = useAuth();

  if (loading) {
    return (
      <PublicLayout>
        <p className="muted">Carregando…</p>
      </PublicLayout>
    );
  }
  if (user?.role !== "OWNER") {
    return <OwnerLogin />;
  }

  const tab = ({ isActive }: { isActive: boolean }) => (isActive ? "active" : undefined);

  return (
    <AdminCtx.Provider value={{ logout: () => void logout() }}>
      <div className="page has-tabs">
        <div className="shell wide">
          <header className="admin-top">
            <Link to="/admin" className="wordmark">
              {SHOP_NAME}
            </Link>
            <button className="btn ghost small" onClick={() => void logout()}>
              Sair
            </button>
          </header>
          <nav className="tabbar" aria-label="Seções do painel">
            <NavLink to="/admin" end className={tab}>
              Agenda
            </NavLink>
            <NavLink to="/admin/faturamento" className={tab}>
              Faturamento
            </NavLink>
            <NavLink to="/admin/cadastros" className={tab}>
              Cadastros
            </NavLink>
            <NavLink to="/admin/clientes" className={tab}>
              Clientes
            </NavLink>
          </nav>
        </div>
        <main className="shell wide" style={{ paddingTop: "1.25rem" }}>
          <Routes>
            <Route index element={<Agenda />} />
            <Route path="faturamento" element={<Revenue />} />
            <Route path="cadastros" element={<Catalog />} />
            <Route path="clientes" element={<Clients />} />
          </Routes>
        </main>
      </div>
    </AdminCtx.Provider>
  );
}
