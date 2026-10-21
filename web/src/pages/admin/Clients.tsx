import { admin } from "../../api";
import { useLoad } from "./util";

export default function Clients() {
  const { data, error } = useLoad(() => admin.customers(), []);

  return (
    <div className="stack">
      <h2>Clientes</h2>
      {error && <p className="alert">{error}</p>}
      {!data && !error && <p className="muted">Carregando…</p>}
      {data && data.length === 0 && (
        <p className="muted">Os clientes aparecem aqui depois do primeiro agendamento.</p>
      )}
      {data && data.length > 0 && (
        <table className="t">
          <thead>
            <tr>
              <th>Nome</th>
              <th>Celular</th>
              <th className="right">Agendamentos</th>
            </tr>
          </thead>
          <tbody>
            {data.map((c) => (
              <tr key={c.id}>
                <td>{c.name}</td>
                <td>
                  <a href={`tel:+55${c.phone.replace(/\D/g, "").replace(/^55/, "")}`}>{c.phone}</a>
                </td>
                <td className="right">{c.appointments}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
