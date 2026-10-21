import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError, type Barber, type Service, type Slot } from "../api";
import { useAuth } from "../auth";
import AuthPanel from "../components/AuthPanel";
import {
  addDays,
  dateTimeLong,
  dayLong,
  duration,
  money,
  parseYmd,
  timeOf,
  weekdayShort,
  ymd,
} from "../format";

const STEPS = ["Serviço", "Barbeiro", "Horário", "Confirmar"] as const;

interface Done {
  id: number;
  startsAt: string;
}

function Avatar({ barber }: { barber: Barber }) {
  if (barber.photoUrl) {
    return <img className="avatar" src={barber.photoUrl} alt="" width={44} height={44} />;
  }
  return (
    <span className="avatar" aria-hidden>
      {barber.id === 0 ? "★" : barber.name.slice(0, 1).toUpperCase()}
    </span>
  );
}

export default function Book() {
  const { user, customer, loading: authLoading, logout } = useAuth();
  const [step, setStep] = useState(0);
  const [services, setServices] = useState<Service[]>();
  const [barbers, setBarbers] = useState<Barber[]>();
  const [loadError, setLoadError] = useState("");

  const [serviceId, setServiceId] = useState<number>();
  const [barberId, setBarberId] = useState<number>(0); // 0 = qualquer barbeiro
  const today = useMemo(() => ymd(new Date()), []);
  const [date, setDate] = useState(today);
  const [slots, setSlots] = useState<Slot[]>();
  const [slotsError, setSlotsError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [slot, setSlot] = useState<Slot>();

  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const [done, setDone] = useState<Done>();

  useEffect(() => {
    let alive = true;
    Promise.all([api.services(), api.barbers()])
      .then(([s, b]) => {
        if (!alive) return;
        setServices(s);
        setBarbers(b);
      })
      .catch((e: ApiError) => alive && setLoadError(e.message));
    return () => {
      alive = false;
    };
  }, []);

  // Busca horários sempre que a escolha muda e a etapa de horário está aberta.
  useEffect(() => {
    if (step !== 2 || !serviceId) return;
    let alive = true;
    setSlots(undefined);
    setSlotsError("");
    api
      .availability({ date, serviceId, barberId: barberId || undefined })
      .then((r) => alive && setSlots(r.slots))
      .catch((e: ApiError) => alive && setSlotsError(e.message));
    return () => {
      alive = false;
    };
  }, [step, serviceId, barberId, date, refresh]);

  const service = services?.find((s) => s.id === serviceId);
  const days = useMemo(() => Array.from({ length: 14 }, (_, i) => addDays(today, i)), [today]);
  const isClient = user?.role === "CLIENT";

  // Com "qualquer barbeiro", um mesmo horário pode vir de mais de um barbeiro: mostramos uma vez.
  const visibleSlots = useMemo(() => {
    if (!slots) return [];
    if (barberId) return slots;
    const seen = new Map<string, Slot>();
    for (const s of slots) if (!seen.has(s.time)) seen.set(s.time, s);
    return [...seen.values()];
  }, [slots, barberId]);

  const canContinue = (step === 0 && !!serviceId) || step === 1 || (step === 2 && !!slot);

  async function submit() {
    if (!service || !slot) return;
    setSubmitting(true);
    setFormError("");
    try {
      const r = await api.book({
        serviceId: service.id,
        barberId: slot.barberId,
        startsAt: slot.startsAt,
      });
      setDone({ id: r.id, startsAt: r.startsAt });
    } catch (e) {
      const err = e as ApiError;
      if (err.status === 409) {
        setSlot(undefined);
        setRefresh((n) => n + 1);
        setStep(2);
        setFormError("Esse horário acabou de ser ocupado. Escolha outro.");
      } else {
        setFormError(err.message);
      }
    } finally {
      setSubmitting(false);
    }
  }

  // ---------- Confirmação ----------
  if (done && service && slot) {
    return (
      <div className="stack" style={{ paddingTop: "0.5rem" }}>
        <div className="pole-banner" aria-hidden />
        <h1>Horário reservado</h1>
        <p>
          Enviamos a confirmação para <strong>{user?.email}</strong>. A barbearia vai confirmar o seu
          horário, e você recebe um lembrete 2 horas antes.
        </p>
        <dl className="summary">
          <div>
            <dt>Serviço</dt>
            <dd>{service.name}</dd>
          </div>
          <div>
            <dt>Barbeiro</dt>
            <dd>{slot.barberName}</dd>
          </div>
          <div>
            <dt>Quando</dt>
            <dd>{dateTimeLong(done.startsAt)}</dd>
          </div>
          <div>
            <dt>Valor</dt>
            <dd>{money(service.priceCents)}</dd>
          </div>
        </dl>
        <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
          <Link className="btn" to="/conta">
            Ver meus agendamentos
          </Link>
          <button
            className="btn ghost"
            onClick={() => {
              setDone(undefined);
              setSlot(undefined);
              setStep(0);
            }}
          >
            Agendar outro horário
          </button>
        </div>
      </div>
    );
  }

  // ---------- Fluxo ----------
  return (
    <div>
      <div
        className="pole"
        role="progressbar"
        aria-valuemin={1}
        aria-valuemax={STEPS.length}
        aria-valuenow={step + 1}
        aria-label="Progresso do agendamento"
      >
        <span style={{ width: `${((step + 1) / STEPS.length) * 100}%` }} />
      </div>

      <div className="step-head">
        <p className="muted small">
          Passo {step + 1} de {STEPS.length}
        </p>
        <h2>
          {step === 0 && "Qual serviço?"}
          {step === 1 && "Com qual barbeiro?"}
          {step === 2 && "Qual dia e horário?"}
          {step === 3 && (isClient ? "Confirme o agendamento" : "Entre para confirmar")}
        </h2>
        {step === 0 && (
          <p className="muted">
            Escolha o serviço, o barbeiro e o horário. Você recebe a confirmação por e-mail e um
            lembrete 2 horas antes.
          </p>
        )}
      </div>

      {loadError && (
        <p className="alert" role="alert">
          {loadError}{" "}
          <button className="btn small ghost" onClick={() => window.location.reload()}>
            Tentar de novo
          </button>
        </p>
      )}
      {!loadError && !services && <p className="muted">Carregando…</p>}

      {step === 0 && services && (
        <>
          {services.length === 0 && (
            <p className="muted">Ainda não há serviços cadastrados. O dono cadastra na área da barbearia.</p>
          )}
          <ul className="menu">
            {services.map((s) => (
              <li key={s.id}>
                <button
                  className="menu-row"
                  aria-pressed={serviceId === s.id}
                  onClick={() => {
                    setServiceId(s.id);
                    setSlot(undefined);
                  }}
                >
                  <span className="menu-line">
                    <span className="menu-name">{s.name}</span>
                    <span className="leader" aria-hidden />
                    <span className="menu-price">{money(s.priceCents)}</span>
                  </span>
                  <span className="muted small">{duration(s.durationMin)}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {step === 1 && barbers && (
        <ul className="menu">
          {[{ id: 0, name: "Qualquer barbeiro" } as Barber, ...barbers].map((b) => (
            <li key={b.id}>
              <button
                className="menu-row with-avatar"
                aria-pressed={barberId === b.id}
                onClick={() => {
                  setBarberId(b.id);
                  setSlot(undefined);
                }}
              >
                <Avatar barber={b} />
                <span>
                  <span className="menu-name">{b.name}</span>
                  {b.id === 0 && (
                    <>
                      <br />
                      <span className="muted small">Mostra todos os horários livres</span>
                    </>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {step === 2 && (
        <div className="stack">
          {formError && (
            <p className="alert" role="alert">
              {formError}
            </p>
          )}
          <div className="days" role="group" aria-label="Dia">
            {days.map((d) => (
              <button
                key={d}
                className="day"
                aria-pressed={date === d}
                aria-label={dayLong(d)}
                onClick={() => {
                  setDate(d);
                  setSlot(undefined);
                  setFormError("");
                }}
              >
                <span className="small">{weekdayShort(d)}</span>
                <b>{parseYmd(d).getDate()}</b>
              </button>
            ))}
          </div>
          <h3>{dayLong(date)}</h3>
          {slotsError && (
            <p className="alert" role="alert">
              {slotsError}
            </p>
          )}
          {!slots && !slotsError && <p className="muted">Buscando horários livres…</p>}
          {slots && visibleSlots.length === 0 && (
            <p className="muted">Sem horários livres neste dia. Escolha outro dia na faixa acima.</p>
          )}
          <div className="slots" role="group" aria-label="Horários livres">
            {visibleSlots.map((s) => (
              <button
                key={`${s.barberId}-${s.time}`}
                className="slot"
                aria-pressed={slot?.startsAt === s.startsAt && slot?.barberId === s.barberId}
                onClick={() => {
                  setSlot(s);
                  setFormError("");
                }}
              >
                {s.time}
              </button>
            ))}
          </div>
        </div>
      )}

      {step === 3 && service && slot && (
        <div className="stack">
          <dl className="summary">
            <div>
              <dt>Serviço</dt>
              <dd>
                {service.name} · {money(service.priceCents)}
              </dd>
            </div>
            <div>
              <dt>Barbeiro</dt>
              <dd>{slot.barberName}</dd>
            </div>
            <div>
              <dt>Quando</dt>
              <dd>
                {dateTimeLong(slot.startsAt)} ({duration(service.durationMin)})
              </dd>
            </div>
            {isClient && (
              <div>
                <dt>Cliente</dt>
                <dd>{customer?.name}</dd>
              </div>
            )}
          </dl>

          {formError && (
            <p className="alert" role="alert">
              {formError}
            </p>
          )}
          {authLoading && <p className="muted">Carregando…</p>}
          {!authLoading && !user && (
            <>
              <p className="muted">
                Entre ou crie uma conta para reservar. O horário escolhido fica guardado.
              </p>
              <AuthPanel onDone={() => setFormError("")} />
            </>
          )}
          {!authLoading && user && !isClient && (
            <>
              <p className="alert" role="alert">
                Você está com a conta do dono da barbearia. Para agendar, entre com uma conta de cliente.
              </p>
              <button className="btn ghost" onClick={() => void logout()}>
                Sair da conta do dono
              </button>
            </>
          )}
          {isClient && (
            <p className="muted small">
              Os avisos chegam em {user?.email}. Para mudar nome ou celular, vá em{" "}
              <Link to="/conta">Meus agendamentos</Link>.
            </p>
          )}
        </div>
      )}

      <div className="actions">
        <div className="shell">
          {step > 0 && (
            <button
              className="btn ghost"
              onClick={() => {
                setFormError("");
                setStep(step - 1);
              }}
              disabled={submitting}
            >
              Voltar
            </button>
          )}
          {step < 3 && (
            <button className="btn" disabled={!canContinue} onClick={() => setStep(step + 1)}>
              Continuar
            </button>
          )}
          {step === 3 && isClient && (
            <button className="btn" disabled={submitting} onClick={() => void submit()}>
              {submitting ? "Reservando…" : "Confirmar agendamento"}
            </button>
          )}
        </div>
      </div>
      {step === 2 && slot && (
        <p className="muted small" style={{ marginTop: "1rem" }}>
          Selecionado: {timeOf(slot.startsAt)} com {slot.barberName}.
        </p>
      )}
    </div>
  );
}
