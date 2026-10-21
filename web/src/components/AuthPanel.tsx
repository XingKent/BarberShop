import { useState } from "react";
import { auth, ApiError } from "../api";
import { useAuth } from "../auth";
import { phoneMask } from "../format";

type Mode = "login" | "register" | "verify" | "forgot" | "reset";

/**
 * Entrar, criar conta, confirmar o e-mail e recuperar a senha do cliente.
 * Usado dentro do agendamento e na página /entrar. `onDone` roda quando a pessoa fica logada.
 */
export default function AuthPanel({
  onDone,
  initialMode = "login",
}: {
  onDone: () => void;
  initialMode?: "login" | "register";
}) {
  const { refresh } = useAuth();
  const [mode, setMode] = useState<Mode>(initialMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  function go(next: Mode, message = "") {
    setMode(next);
    setError("");
    setInfo(message);
    setPassword("");
    setCode("");
  }

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    setInfo("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Algo deu errado. Tente de novo.");
    } finally {
      setBusy(false);
    }
  }

  const finish = async () => {
    await refresh();
    onDone();
  };

  const submitLogin = (e: React.FormEvent) => {
    e.preventDefault();
    void run(async () => {
      try {
        await auth.login(email.trim(), password);
        await finish();
      } catch (err) {
        if (err instanceof ApiError && err.code === "EMAIL_NOT_VERIFIED") {
          go("verify", "Seu e-mail ainda não foi confirmado. Enviamos um novo código para ele.");
          return;
        }
        throw err;
      }
    });
  };

  const submitRegister = (e: React.FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await auth.register({ name: name.trim(), phone, email: email.trim(), password });
      go("verify", `Enviamos um código de 6 números para ${email.trim()}.`);
    });
  };

  const submitVerify = (e: React.FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await auth.verifyEmail(email.trim(), code.trim());
      await finish();
    });
  };

  const resend = () =>
    void run(async () => {
      await auth.resendCode(email.trim());
      setInfo("Enviamos um novo código. O anterior deixa de valer.");
    });

  const submitForgot = (e: React.FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await auth.forgotPassword(email.trim());
      go("reset", "Se existir uma conta com esse e-mail, enviamos um código de 6 números.");
    });
  };

  const submitReset = (e: React.FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await auth.resetPassword({ email: email.trim(), code: code.trim(), password });
      go("login", "Senha alterada. Entre com a nova senha.");
    });
  };

  const showTabs = mode === "login" || mode === "register";

  return (
    <div className="stack">
      {showTabs && (
        <div className="tabs" role="tablist" aria-label="Acesso à conta">
          <button
            role="tab"
            className="tab"
            aria-selected={mode === "login"}
            onClick={() => go("login")}
            type="button"
          >
            Entrar
          </button>
          <button
            role="tab"
            className="tab"
            aria-selected={mode === "register"}
            onClick={() => go("register")}
            type="button"
          >
            Criar conta
          </button>
        </div>
      )}

      {info && (
        <p className="notice" role="status">
          {info}
        </p>
      )}
      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}

      {mode === "login" && (
        <form className="stack" onSubmit={submitLogin}>
          <label className="field">
            <span>E-mail</span>
            <input
              className="input"
              type="email"
              autoComplete="email"
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
          <button className="btn" type="submit" disabled={busy}>
            {busy ? "Entrando…" : "Entrar"}
          </button>
          <button className="linkbtn" type="button" onClick={() => go("forgot")}>
            Esqueci minha senha
          </button>
        </form>
      )}

      {mode === "register" && (
        <form className="stack" onSubmit={submitRegister}>
          <label className="field">
            <span>Nome</span>
            <input
              className="input"
              autoComplete="name"
              required
              minLength={2}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label className="field">
            <span>Celular com DDD</span>
            <input
              className="input"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="(21) 99999-9999"
              required
              value={phone}
              onChange={(e) => setPhone(phoneMask(e.target.value))}
            />
          </label>
          <label className="field">
            <span>E-mail</span>
            <input
              className="input"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label className="field">
            <span>Senha (mínimo de 8 caracteres)</span>
            <input
              className="input"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <p className="muted small">
            Vamos enviar um código para o seu e-mail. É por ele que chegam a confirmação e o lembrete
            do horário.
          </p>
          <button className="btn" type="submit" disabled={busy}>
            {busy ? "Criando conta…" : "Criar conta"}
          </button>
        </form>
      )}

      {mode === "verify" && (
        <form className="stack" onSubmit={submitVerify}>
          <h3>Confirme seu e-mail</h3>
          <label className="field">
            <span>Código de 6 números</span>
            <input
              className="input code-input"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6}"
              maxLength={6}
              required
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            />
          </label>
          <button className="btn" type="submit" disabled={busy || code.length !== 6}>
            {busy ? "Confirmando…" : "Confirmar e entrar"}
          </button>
          <button className="linkbtn" type="button" onClick={resend} disabled={busy}>
            Enviar um novo código
          </button>
          <button className="linkbtn" type="button" onClick={() => go("login")}>
            Voltar
          </button>
        </form>
      )}

      {mode === "forgot" && (
        <form className="stack" onSubmit={submitForgot}>
          <h3>Esqueci minha senha</h3>
          <p className="muted">Informe o e-mail da conta. Enviamos um código para criar uma nova senha.</p>
          <label className="field">
            <span>E-mail</span>
            <input
              className="input"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <button className="btn" type="submit" disabled={busy}>
            {busy ? "Enviando…" : "Enviar código"}
          </button>
          <button className="linkbtn" type="button" onClick={() => go("login")}>
            Voltar
          </button>
        </form>
      )}

      {mode === "reset" && (
        <form className="stack" onSubmit={submitReset}>
          <h3>Criar nova senha</h3>
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
          <label className="field">
            <span>Nova senha (mínimo de 8 caracteres)</span>
            <input
              className="input"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <button className="btn" type="submit" disabled={busy || code.length !== 6}>
            {busy ? "Salvando…" : "Salvar nova senha"}
          </button>
          <button className="linkbtn" type="button" onClick={() => go("forgot")}>
            Enviar um novo código
          </button>
        </form>
      )}
    </div>
  );
}
