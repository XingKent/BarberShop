import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { api, type ApiError, type MyAppointment } from "../api";
import { dateTimeLong, money, statusLabel } from "../format";

export default function MyBooking() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const [appt, setAppt] = useState<MyAppointment>();
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    if (!id || !token) {
      setError("Link incompleto. Abra o link completo que você recebeu ao agendar.");
      return;
    }
    api
      .myAppointment(Number(id), token)
      .then((a) => alive && setAppt(a))
      .catch((e: ApiError) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [id, token]);

  async function cancel() {
    setBusy(true);
    setError("");
    try {
      await api.cancelMine(Number(id), token);
      setAppt((a) => (a ? { ...a, status: "CANCELED" } : a));
      setConfirming(false);
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  if (error && !appt) {
    return (
      <div className="stack" style={{ paddingTop: "1rem" }}>
        <h1>Agendamento não encontrado</h1>
        <p className="alert" role="alert">
          {error}
        </p>
        <Link className="btn" to="/agendar">
          Agendar um horário
        </Link>
      </div>
    );
  }
  if (!appt) return <p className="muted">Carregando…</p>;

  const canCancel =
    (appt.status === "PENDING" || appt.status === "CONFIRMED") &&
    new Date(appt.startsAt).getTime() > Date.now();

  return (
    <div className="stack" style={{ paddingTop: "0.5rem" }}>
      <div className="pole-banner" aria-hidden />
      <h1>{appt.status === "CANCELED" ? "Agendamento cancelado" : "Seu agendamento"}</h1>
      <p className={`pill ${appt.status}`}>{statusLabel[appt.status]}</p>
      <dl className="summary">
        <div>
          <dt>Cliente</dt>
          <dd>{appt.customer}</dd>
        </div>
        <div>
          <dt>Serviço</dt>
          <dd>{appt.service}</dd>
        </div>
        <div>
          <dt>Barbeiro</dt>
          <dd>{appt.barber}</dd>
        </div>
        <div>
          <dt>Quando</dt>
          <dd>{dateTimeLong(appt.startsAt)}</dd>
        </div>
        <div>
          <dt>Valor</dt>
          <dd>{money(appt.priceCents)}</dd>
        </div>
      </dl>
      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
      {canCancel && !confirming && (
        <button className="btn danger-ghost" onClick={() => setConfirming(true)}>
          Cancelar agendamento
        </button>
      )}
      {canCancel && confirming && (
        <div className="stack">
          <p>O horário volta a ficar livre para outros clientes. Cancelar mesmo?</p>
          <div style={{ display: "flex", gap: "0.75rem" }}>
            <button className="btn ghost" onClick={() => setConfirming(false)} disabled={busy}>
              Manter horário
            </button>
            <button className="btn" onClick={() => void cancel()} disabled={busy}>
              {busy ? "Cancelando…" : "Cancelar agendamento"}
            </button>
          </div>
        </div>
      )}
      {appt.status === "CANCELED" && (
        <Link className="btn" to="/agendar">
          Agendar outro horário
        </Link>
      )}
    </div>
  );
}
