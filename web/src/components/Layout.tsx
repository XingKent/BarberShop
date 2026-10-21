import { Link } from "react-router-dom";
import { useAuth } from "../auth";
import { SHOP_ADDRESS, SHOP_NAME, SHOP_PHONE } from "../format";

/** Cabeçalho, conteúdo e rodapé das páginas do cliente. `wide` abre a página para telas grandes. */
export function PublicLayout({ children, wide = false }: { children: React.ReactNode; wide?: boolean }) {
  const { user, loading } = useAuth();
  const shell = wide ? "shell wide" : "shell";

  return (
    <div className="page">
      <div className={shell}>
        <header className="masthead masthead-bar">
          <Link to="/" className="wordmark">
            {SHOP_NAME}
          </Link>
          <nav className="topnav" aria-label="Conta">
            {!loading && user?.role === "CLIENT" && <Link to="/conta">Meus agendamentos</Link>}
            {!loading && user?.role === "OWNER" && <Link to="/admin">Painel da barbearia</Link>}
            {!loading && !user && <Link to="/entrar">Entrar</Link>}
          </nav>
        </header>
      </div>
      <main className={shell}>{children}</main>
      <footer className={`${shell} footer`}>
        {(SHOP_ADDRESS || SHOP_PHONE) && (
          <p>
            {SHOP_ADDRESS}
            {SHOP_ADDRESS && SHOP_PHONE && <br />}
            {SHOP_PHONE}
          </p>
        )}
        <Link to="/admin">Área da barbearia</Link>
      </footer>
    </div>
  );
}
