import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type Barber, type Service } from "../api";
import { useAuth } from "../auth";
import { duration, money } from "../format";

function Avatar({ barber }: { barber: Barber }) {
  if (barber.photoUrl) {
    return <img className="avatar big" src={barber.photoUrl} alt="" width={56} height={56} />;
  }
  return (
    <span className="avatar big" aria-hidden>
      {barber.name.slice(0, 1).toUpperCase()}
    </span>
  );
}

export default function Home() {
  const { user } = useAuth();
  const [services, setServices] = useState<Service[]>();
  const [barbers, setBarbers] = useState<Barber[]>();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    Promise.all([api.services(), api.barbers()])
      .then(([s, b]) => {
        if (!alive) return;
        setServices(s);
        setBarbers(b);
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="stack" style={{ gap: "2.5rem" }}>
      <section className="hero">
        <div className="stack hero-copy">
          <h1 className="hero-title">Corte e barba com hora marcada</h1>
          <p className="lead">
            Escolha o serviço, o barbeiro e o horário. A confirmação chega por e-mail, e um lembrete
            avisa 2 horas antes.
          </p>
          <div className="hero-actions">
            <Link className="btn" to="/agendar">
              Agendar horário
            </Link>
            {user?.role === "CLIENT" ? (
              <Link className="btn ghost" to="/conta">
                Meus agendamentos
              </Link>
            ) : (
              !user && (
                <Link className="btn ghost" to="/entrar">
                  Entrar
                </Link>
              )
            )}
          </div>
        </div>
        <div className="pole-vert" role="img" aria-label="Poste de barbeiro" />
      </section>

      <section className="stack">
        <h2>Serviços e preços</h2>
        {failed && (
          <p className="alert" role="alert">
            Não conseguimos carregar os serviços agora. Atualize a página em instantes.
          </p>
        )}
        {!services && !failed && <p className="muted">Carregando…</p>}
        {services && services.length === 0 && (
          <p className="muted">Os serviços aparecem aqui assim que a barbearia cadastrar.</p>
        )}
        {services && services.length > 0 && (
          <ul className="menu">
            {services.map((s) => (
              <li key={s.id} className="menu-static">
                <span className="menu-line">
                  <span className="menu-name">{s.name}</span>
                  <span className="leader" aria-hidden />
                  <span className="menu-price">{money(s.priceCents)}</span>
                </span>
                <span className="muted small">{duration(s.durationMin)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {barbers && barbers.length > 0 && (
        <section className="stack">
          <h2>Barbeiros</h2>
          <ul className="team">
            {barbers.map((b) => (
              <li key={b.id}>
                <Avatar barber={b} />
                <span>{b.name}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="stack cta-band">
        <h2>Pronto para marcar?</h2>
        <p className="muted">Leva menos de um minuto. Se mudar de ideia, cancele pelo link do e-mail.</p>
        <div>
          <Link className="btn" to="/agendar">
            Agendar horário
          </Link>
        </div>
      </section>
    </div>
  );
}
