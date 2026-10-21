import { useMemo, useState } from "react";
import { admin, api, type AdminAppointment, type Status } from "../../api";
import { addDays, dayLong, money, statusLabel, timeOf, ymd } from "../../format";
import { useAdminAction, useLoad } from "./util";

const actionsFor: Record<Status, { to: Status; label: string; danger?: boolean }[]> = {
  PENDING: [
    { to: "CONFIRMED", label: "Confirmar" },
    { to: "CANCELED", label: "Cancelar", danger: true },
  ],
  CONFIRMED: [
    { to: "COMPLETED", label: "Concluir atendimento" },
    { to: "CANCELED", label: "Cancelar", danger: true },
  ],
  CANCELED: [],
  COMPLETED: [],
};

export default function Agenda() {
  const today = useMemo(() => ymd(new Date()), []);
  const [date, setDate] = useState(today);
  const [barberId, setBarberId] = useState(0);
  const [busyId, setBusyId] = useState<number>();
  const [actionError, setActionError] = useState("");
  const onError = useAdminAction();

  const list = useLoad(() => admin.appointments({ from: date }), [date]);
  const barbers = useLoad(() => api.barbers(), []);

  const items: AdminAppointment[] = (list.data ?? []).filter(
    (a) => !barberId || a.barberId === barberId,
  );
  const expected = items
    .filter((a) => a.status !== "CANCELED")
    .reduce((sum, a) => sum + a.priceCents, 0);

  async function change(a: AdminAppointment, to: Status) {
    setBusyId(a.id);
    setActionError("");
    try {
      await admin.setStatus(a.id, to);
      list.reload();
    } catch (e) {
      setActionError(onError(e));
    } finally {
      setBusyId(undefined);
    }
  }

  return (
    <div className="stack">
      <div className="toolbar">
        <button className="btn ghost small" aria-label="Dia anterior" onClick={() => setDate(addDays(date, -1))}>
          ‹
        </button>
        <input
          className="input"
          type="date"
          value={date}
          aria-label="Dia"
          onChange={(e) => e.target.value && setDate(e.target.value)}
        />
        <button className="btn ghost small" aria-label="Próximo dia" onClick={() => setDate(addDays(date, 1))}>
          ›
        </button>
        {date !== today && (
          <button className="btn ghost small" onClick={() => setDate(today)}>
            Hoje
          </button>
        )}
        <select
          className="input"
          aria-label="Barbeiro"
          value={barberId}
          onChange={(e) => setBarberId(Number(e.target.value))}
        >
          <option value={0}>Todos os barbeiros</option>
          {barbers.data?.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <h2>{dayLong(date)}</h2>
        {list.data && (
          <p className="muted">
            {items.length === 0
              ? "Nenhum agendamento."
              : `${items.length} ${items.length === 1 ? "agendamento" : "agendamentos"}, ${money(expected)} previstos (sem os cancelados).`}
          </p>
        )}
      </div>

      {(list.error || actionError) && (
        <p className="alert" role="alert">
          {list.error || actionError}
        </p>
      )}
      {!list.data && !list.error && <p className="muted">Carregando…</p>}
      {list.data && items.length === 0 && (
        <p className="muted">
          Os horários aparecem aqui assim que um cliente reservar. Escolha outro dia para ver os
          próximos.
        </p>
      )}

      <ul className="list" style={{ borderTop: items.length ? undefined : "0" }}>
        {items.map((a) => (
          <li key={a.id} className="appt">
            <div className="appt-head">
              <span className="appt-time">
                {timeOf(a.startsAt)}–{timeOf(a.endsAt)}
              </span>
              <span className={`pill ${a.status}`}>{statusLabel[a.status]}</span>
            </div>
            <div>
              <strong>{a.customer}</strong> ·{" "}
              <a href={`tel:+55${a.phone.replace(/\D/g, "").replace(/^55/, "")}`}>{a.phone}</a>
              <br />
              <span className="muted">
                {a.service} com {a.barber} · {money(a.priceCents)}
              </span>
            </div>
            {actionsFor[a.status].length > 0 && (
              <div className="appt-actions">
                {actionsFor[a.status].map((act) => (
                  <button
                    key={act.to}
                    className={`btn small ${act.danger ? "danger-ghost" : ""}`}
                    disabled={busyId === a.id}
                    onClick={() => void change(a, act.to)}
                  >
                    {act.label}
                  </button>
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
