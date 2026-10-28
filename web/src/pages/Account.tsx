import { useCallback, useEffect, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { account, auth, type AccountAppointment, type ApiError } from "../api";
import { useAuth } from "../auth";
import { dateTimeLong, money, phoneMask, statusLabel } from "../format";

function AppointmentRow({
  a,
  onCanceled,
}: {
  a: AccountAppointment;
  onCanceled: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const canCancel =
    (a.status === "PENDING" || a.status === "CONFIRMED") && new Date(a.startsAt).getTime() > Date.now();

  async function cancel() {
    setBusy(true);
    setError("");
    try {
      await account.cancel(a.id);
      onCanceled();
    } catch (e) {
      setError((e as ApiError).message);
      setBusy(false);
    }
  }

  return (
    <li className="appt">
      <div className="appt-head">
        <strong>{dateTimeLong(a.startsAt)}</strong>
        <span className={`pill ${a.status}`}>{statusLabel[a.status]}</span>
      </div>
      <span className="muted">
        {a.service} com {a.barber} · {money(a.priceCents)}
      </span>
      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
      {canCancel && !confirming && (
        <div className="appt-actions">
          <button className="btn small danger-ghost" onClick={() => setConfirming(true)}>
            Cancelar
          </button>
        </div>
      )}
      {canCancel && confirming && (
        <div className="stack">
          <p>O horário volta a ficar livre para outras pessoas. Cancelar mesmo?</p>
          <div className="appt-actions">
            <button className="btn small ghost" onClick={() => setConfirming(false)} disabled={busy}>
              Manter horário
            </button>
            <button className="btn small" onClick={() => void cancel()} disabled={busy}>
              {busy ? "Cancelando…" : "Cancelar horário"}
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

function Profile() {
  const { user, customer, refresh } = useAuth();
  const [name, setName] = useState(customer?.name ?? "");
  const [phone, setPhone] = useState(customer ? phoneMask(customer.phone) : "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string }>();

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(undefined);
    try {
      await auth.updateProfile({ name: name.trim(), phone });
      await refresh();
      setMsg({ ok: true, text: "Dados salvos." });
    } catch (err) {
      setMsg({ ok: false, text: (err as ApiError).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack" onSubmit={(e) => void save(e)}>
      <h2>Meus dados</h2>
      <p className="muted">
        Os avisos de agendamento chegam em <strong>{user?.email}</strong>.
      </p>
      {msg && (
        <p className={msg.ok ? "notice" : "alert"} role={msg.ok ? "status" : "alert"}>
          {msg.text}
        </p>
      )}
      <label className="field">
        <span>Nome</span>
        <input className="input" required minLength={2} value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="field">
        <span>Celular com DDD</span>
        <input
          className="input"
          type="tel"
          inputMode="tel"
          required
          value={phone}
          onChange={(e) => setPhone(phoneMask(e.target.value))}
        />
      </label>
      <button className="btn ghost" type="submit" disabled={busy}>
        {busy ? "Salvando…" : "Salvar dados"}
      </button>
    </form>
  );
}

function DeleteAccount() {
  const { refresh } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function remove(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await auth.deleteAccount(password);
      await refresh(); // o servidor já encerrou a sessão; isto atualiza o cabeçalho
      navigate("/", { replace: true });
    } catch (err) {
      setError((err as ApiError).message);
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button className="btn small danger-ghost" onClick={() => setOpen(true)}>
        Excluir minha conta
      </button>
    );
  }
  return (
    <form className="stack" onSubmit={(e) => void remove(e)}>
      <h2>Excluir minha conta</h2>
      <p>
        Seu e-mail, senha, nome e celular são apagados. 
        Os horários que você ainda tem marcados são cancelados e voltam a ficar livres. 
        Os atendimentos já feitos continuam no histórico da barbearia, sem o seu nome.
      </p>
      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
      <label className="field">
        <span>Digite sua senha para confirmar</span>
        <input
          className="input"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      <div className="appt-actions">
        <button
          className="btn small ghost"
          type="button"
          disabled={busy}
          onClick={() => {
            setOpen(false);
            setPassword("");
            setError("");
          }}
        >
          Manter minha conta
        </button>
        <button className="btn small" type="submit" disabled={busy || !password}>
          {busy ? "Excluindo…" : "Excluir para sempre"}
        </button>
      </div>
    </form>
  );
}

export default function Account() {
  const { user, loading, logout } = useAuth();
  const [items, setItems] = useState<AccountAppointment[]>();
  const [error, setError] = useState("");

  const load = useCallback(() => {
    account
      .appointments()
      .then(setItems)
      .catch((e: ApiError) => setError(e.message));
  }, []);

  useEffect(() => {
    if (user?.role === "CLIENT") load();
  }, [user, load]);

  if (loading) return <p className="muted">Carregando…</p>;
  if (!user || user.role !== "CLIENT") return <Navigate to="/entrar?next=/conta" replace />;

  const now = Date.now();
  const active = (a: AccountAppointment) => a.status === "PENDING" || a.status === "CONFIRMED";
  const upcoming = (items ?? []).filter((a) => active(a) && new Date(a.startsAt).getTime() > now);
  const past = (items ?? []).filter((a) => !upcoming.includes(a));
  // O mais próximo primeiro nos próximos; o mais recente primeiro no histórico.
  upcoming.sort((a, b) => a.startsAt.localeCompare(b.startsAt));

  return (
    <div className="stack" style={{ gap: "2rem", paddingTop: "0.75rem" }}>
      <section className="stack">
        <h1>Meus agendamentos</h1>
        {error && (
          <p className="alert" role="alert">
            {error}
          </p>
        )}
        {!items && !error && <p className="muted">Carregando…</p>}
        {items && upcoming.length === 0 && (
          <p className="muted">Você não tem horários marcados.</p>
        )}
        <ul className="list" style={{ borderTop: upcoming.length ? undefined : "0" }}>
          {upcoming.map((a) => (
            <AppointmentRow key={a.id} a={a} onCanceled={load} />
          ))}
        </ul>
        <Link className="btn" to="/agendar">
          Agendar um horário
        </Link>
      </section>

      {past.length > 0 && (
        <section className="stack">
          <h2>Histórico</h2>
          <ul className="list">
            {past.map((a) => (
              <AppointmentRow key={a.id} a={a} onCanceled={load} />
            ))}
          </ul>
        </section>
      )}

      <Profile />

      <button className="btn ghost" onClick={() => void logout()}>
        Sair da conta
      </button>

      <DeleteAccount />
    </div>
  );
}
