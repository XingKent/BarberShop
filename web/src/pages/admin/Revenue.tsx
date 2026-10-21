import { useMemo, useState } from "react";
import { admin } from "../../api";
import { addDays, money, parseYmd, ymd } from "../../format";
import { useLoad } from "./util";

export default function Revenue() {
  const today = useMemo(() => ymd(new Date()), []);
  const [from, setFrom] = useState(addDays(today, -6));
  const [to, setTo] = useState(today);

  const valid = from <= to;
  const { data, error } = useLoad(
    () => (valid ? admin.revenue(from, to) : Promise.reject(new Error("A data inicial deve ser antes da final."))),
    [from, to],
  );

  const monthStart = `${today.slice(0, 8)}01`;
  const max = Math.max(1, ...(data?.byDay.map((d) => d.totalCents) ?? [0]));

  const presets: { label: string; from: string; to: string }[] = [
    { label: "Hoje", from: today, to: today },
    { label: "Últimos 7 dias", from: addDays(today, -6), to: today },
    { label: "Este mês", from: monthStart, to: today },
  ];

  return (
    <div className="stack">
      <div className="toolbar">
        {presets.map((p) => (
          <button
            key={p.label}
            className="btn ghost small"
            aria-pressed={from === p.from && to === p.to}
            onClick={() => {
              setFrom(p.from);
              setTo(p.to);
            }}
          >
            {p.label}
          </button>
        ))}
      </div>
      <div className="toolbar">
        <label className="toolbar">
          <span>De</span>
          <input className="input" type="date" value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} />
        </label>
        <label className="toolbar">
          <span>até</span>
          <input className="input" type="date" value={to} onChange={(e) => e.target.value && setTo(e.target.value)} />
        </label>
      </div>

      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
      {!data && !error && <p className="muted">Carregando…</p>}

      {data && (
        <>
          <div>
            <h2>{money(data.totalCents)}</h2>
            <p className="muted">
              {data.count === 0
                ? "Nenhum atendimento concluído neste período. Marque os atendimentos como concluídos na agenda para somar aqui."
                : `em ${data.count} ${data.count === 1 ? "atendimento concluído" : "atendimentos concluídos"}, ticket médio de ${money(data.averageTicketCents)}.`}
            </p>
          </div>

          {data.byDay.length > 0 && (
            <section className="stack">
              <h3>Por dia</h3>
              <div className="bars">
                {data.byDay.map((d) => (
                  <div className="bar" key={d.date}>
                    <span>
                      {parseYmd(d.date).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}
                    </span>
                    <i style={{ width: `${(d.totalCents / max) * 100}%` }} />
                    <span>{money(d.totalCents)}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {data.byBarber.length > 0 && (
            <section className="stack">
              <h3>Por barbeiro</h3>
              <table className="t">
                <thead>
                  <tr>
                    <th>Barbeiro</th>
                    <th>Atendimentos</th>
                    <th className="right">Faturado</th>
                  </tr>
                </thead>
                <tbody>
                  {data.byBarber.map((b) => (
                    <tr key={b.barberId}>
                      <td>{b.name}</td>
                      <td>{b.count}</td>
                      <td className="right">{money(b.totalCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          {data.byService.length > 0 && (
            <section className="stack">
              <h3>Por serviço</h3>
              <table className="t">
                <thead>
                  <tr>
                    <th>Serviço</th>
                    <th>Atendimentos</th>
                    <th className="right">Faturado</th>
                  </tr>
                </thead>
                <tbody>
                  {data.byService.map((s) => (
                    <tr key={s.serviceId}>
                      <td>{s.name}</td>
                      <td>{s.count}</td>
                      <td className="right">{money(s.totalCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
        </>
      )}
    </div>
  );
}
