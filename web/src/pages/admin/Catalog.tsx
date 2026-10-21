import { useState } from "react";
import { admin, type Barber } from "../../api";
import { duration, money } from "../../format";
import { squarePhoto } from "../../image";
import { hhmmToMin, minToHHMM, useAdminAction, useLoad, WEEKDAYS } from "./util";

function Services() {
  const { data, error, reload } = useLoad(() => admin.services(), []);
  const onError = useAdminAction();
  const [name, setName] = useState("");
  const [minutes, setMinutes] = useState("30");
  const [price, setPrice] = useState("");
  const [formError, setFormError] = useState("");

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setFormError("");
    const priceCents = Math.round(Number(price.replace(",", ".")) * 100);
    if (!Number.isFinite(priceCents) || priceCents < 0) {
      setFormError("Informe o preço em reais, por exemplo 45 ou 45,50.");
      return;
    }
    try {
      await admin.addService({ name: name.trim(), durationMin: Number(minutes), priceCents });
      setName("");
      setPrice("");
      reload();
    } catch (err) {
      setFormError(onError(err));
    }
  }

  async function toggle(id: number, active: boolean) {
    try {
      await admin.updateService(id, { active });
      reload();
    } catch (err) {
      setFormError(onError(err));
    }
  }

  return (
    <section className="stack">
      <h2>Serviços</h2>
      {error && <p className="alert">{error}</p>}
      <ul className="list">
        {data?.map((s) => (
          <li className="row" key={s.id} style={{ opacity: s.active ? 1 : 0.55 }}>
            <span>
              <strong>{s.name}</strong>
              <br />
              <span className="muted small">
                {duration(s.durationMin)} · {money(s.priceCents)}
                {!s.active && " · desativado"}
              </span>
            </span>
            <button className="btn ghost small" onClick={() => void toggle(s.id, !s.active)}>
              {s.active ? "Desativar" : "Ativar"}
            </button>
          </li>
        ))}
      </ul>
      <form className="stack" onSubmit={(e) => void add(e)}>
        <h3>Novo serviço</h3>
        {formError && (
          <p className="alert" role="alert">
            {formError}
          </p>
        )}
        <label className="field">
          <span>Nome</span>
          <input className="input" required minLength={2} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <div className="toolbar">
          <label className="field">
            <span>Duração (minutos)</span>
            <input className="input" type="number" min={5} max={480} step={5} required value={minutes} onChange={(e) => setMinutes(e.target.value)} />
          </label>
          <label className="field">
            <span>Preço (R$)</span>
            <input className="input" inputMode="decimal" required value={price} onChange={(e) => setPrice(e.target.value)} />
          </label>
        </div>
        <button className="btn" type="submit">
          Adicionar serviço
        </button>
      </form>
    </section>
  );
}

function HoursEditor({ barber, onSaved }: { barber: Barber; onSaved: () => void }) {
  const onError = useAdminAction();
  const [rows, setRows] = useState(() =>
    WEEKDAYS.map((_, weekday) => {
      const h = barber.hours?.find((x) => x.weekday === weekday);
      return {
        enabled: !!h,
        start: h ? minToHHMM(h.startMin) : "09:00",
        end: h ? minToHHMM(h.endMin) : "18:00",
      };
    }),
  );
  const [msg, setMsg] = useState<{ ok: boolean; text: string }>();

  async function save() {
    setMsg(undefined);
    const hours = rows.flatMap((r, weekday) =>
      r.enabled ? [{ weekday, startMin: hhmmToMin(r.start), endMin: hhmmToMin(r.end) }] : [],
    );
    if (hours.some((h) => h.endMin <= h.startMin)) {
      setMsg({ ok: false, text: "Em cada dia, o fim deve ser depois do início." });
      return;
    }
    try {
      await admin.setHours(barber.id, hours);
      setMsg({ ok: true, text: "Horários salvos." });
      onSaved();
    } catch (e) {
      setMsg({ ok: false, text: onError(e) });
    }
  }

  return (
    <div className="stack" style={{ paddingBottom: "1rem" }}>
      <div className="hours-grid">
        {WEEKDAYS.map((day, i) => (
          <div className="hours-row" key={day}>
            <label>
              <input
                type="checkbox"
                checked={rows[i]!.enabled}
                onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, enabled: e.target.checked } : r)))}
              />
              {day}
            </label>
            <input
              className="input"
              type="time"
              aria-label={`${day}: início`}
              disabled={!rows[i]!.enabled}
              value={rows[i]!.start}
              onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, start: e.target.value } : r)))}
            />
            <input
              className="input"
              type="time"
              aria-label={`${day}: fim`}
              disabled={!rows[i]!.enabled}
              value={rows[i]!.end}
              onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, end: e.target.value } : r)))}
            />
          </div>
        ))}
      </div>
      <p className="muted small">Dias desmarcados são folga: não aparecem horários para o cliente.</p>
      {msg && (
        <p className={msg.ok ? "notice" : "alert"} role="status">
          {msg.text}
        </p>
      )}
      <button className="btn" onClick={() => void save()}>
        Salvar horários
      </button>
    </div>
  );
}

function PhotoEditor({ barber, onSaved }: { barber: Barber; onSaved: () => void }) {
  const onError = useAdminAction();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string }>();

  async function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // permite escolher o mesmo arquivo de novo
    if (!file) return;
    setBusy(true);
    setMsg(undefined);
    try {
      await admin.uploadBarberPhoto(barber.id, await squarePhoto(file));
      setMsg({ ok: true, text: "Foto salva." });
      onSaved();
    } catch (err) {
      setMsg({ ok: false, text: onError(err) });
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setMsg(undefined);
    try {
      await admin.deleteBarberPhoto(barber.id);
      setMsg({ ok: true, text: "Foto removida." });
      onSaved();
    } catch (err) {
      setMsg({ ok: false, text: onError(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack" style={{ paddingBottom: "1rem" }}>
      <p className="muted small">
        Escolha uma foto do rosto, de celular ou computador. Ela é cortada em quadrado e reduzida sozinha.
      </p>
      {msg && (
        <p className={msg.ok ? "notice" : "alert"} role={msg.ok ? "status" : "alert"}>
          {msg.text}
        </p>
      )}
      <div className="toolbar">
        <label className={`btn small${busy ? " disabled" : ""}`} aria-disabled={busy}>
          {busy ? "Enviando…" : barber.photoUrl ? "Trocar foto" : "Escolher foto"}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            disabled={busy}
            onChange={(e) => void pick(e)}
            style={{ position: "absolute", width: 1, height: 1, opacity: 0, overflow: "hidden" }}
          />
        </label>
        {barber.photoUrl && (
          <button className="btn ghost small" disabled={busy} onClick={() => void remove()}>
            Remover foto
          </button>
        )}
      </div>
    </div>
  );
}

function Barbers() {
  const { data, error, reload } = useLoad(() => admin.barbers(), []);
  const onError = useAdminAction();
  const [name, setName] = useState("");
  const [formError, setFormError] = useState("");
  const [open, setOpen] = useState<{ id: number; panel: "hours" | "photo" }>();

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setFormError("");
    try {
      const b = await admin.addBarber(name.trim());
      setName("");
      reload();
      setOpen({ id: b.id, panel: "hours" });
    } catch (err) {
      setFormError(onError(err));
    }
  }

  async function toggle(id: number, active: boolean) {
    try {
      await admin.updateBarber(id, { active });
      reload();
    } catch (err) {
      setFormError(onError(err));
    }
  }

  return (
    <section className="stack">
      <h2>Barbeiros</h2>
      {error && <p className="alert">{error}</p>}
      <ul className="list">
        {data?.map((b) => (
          <li key={b.id} style={{ borderBottom: "1px solid var(--line)", opacity: b.active ? 1 : 0.55 }}>
            <div className="row" style={{ borderBottom: 0, flexWrap: "wrap", gap: "0.6rem" }}>
              <span style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                {b.photoUrl ? (
                  <img className="avatar" src={b.photoUrl} alt="" width={44} height={44} />
                ) : (
                  <span className="avatar" aria-hidden>
                    {b.name.slice(0, 1).toUpperCase()}
                  </span>
                )}
                <span>
                <strong>{b.name}</strong>
                {!b.active && <span className="muted small"> · desativado</span>}
                <br />
                <span className="muted small">
                  {b.hours?.length ? `Trabalha em ${b.hours.length} dias por semana` : "Sem horários: ainda não aparece para o cliente"}
                </span>
                </span>
              </span>
              <span style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                <button
                  className="btn ghost small"
                  aria-expanded={open?.id === b.id && open.panel === "photo"}
                  onClick={() => setOpen(open?.id === b.id && open.panel === "photo" ? undefined : { id: b.id, panel: "photo" })}
                >
                  Foto
                </button>
                <button
                  className="btn ghost small"
                  aria-expanded={open?.id === b.id && open.panel === "hours"}
                  onClick={() => setOpen(open?.id === b.id && open.panel === "hours" ? undefined : { id: b.id, panel: "hours" })}
                >
                  Horários
                </button>
                <button className="btn ghost small" onClick={() => void toggle(b.id, !b.active)}>
                  {b.active ? "Desativar" : "Ativar"}
                </button>
              </span>
            </div>
            {open?.id === b.id && open.panel === "hours" && <HoursEditor key={b.id} barber={b} onSaved={reload} />}
            {open?.id === b.id && open.panel === "photo" && <PhotoEditor key={b.id} barber={b} onSaved={reload} />}
          </li>
        ))}
      </ul>
      <form className="stack" onSubmit={(e) => void add(e)}>
        <h3>Novo barbeiro</h3>
        {formError && (
          <p className="alert" role="alert">
            {formError}
          </p>
        )}
        <label className="field">
          <span>Nome</span>
          <input className="input" required minLength={2} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <button className="btn" type="submit">
          Adicionar barbeiro
        </button>
      </form>
    </section>
  );
}

export default function Catalog() {
  return (
    <div className="stack" style={{ gap: "2.5rem" }}>
      <Services />
      <Barbers />
    </div>
  );
}
