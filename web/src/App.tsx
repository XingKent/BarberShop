import { Link, Route, Routes } from "react-router-dom";
import { PublicLayout } from "./components/Layout";
import Account from "./pages/Account";
import Admin from "./pages/Admin";
import Book from "./pages/Book";
import Home from "./pages/Home";
import Login from "./pages/Login";
import MyBooking from "./pages/MyBooking";

function NotFound() {
  return (
    <div className="stack" style={{ paddingTop: "2rem" }}>
      <h1>Página não encontrada</h1>
      <p className="muted">O endereço que você abriu não existe.</p>
      <div>
        <Link className="btn" to="/agendar">
          Agendar um horário
        </Link>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/admin/*" element={<Admin />} />
      <Route
        path="/"
        element={
          <PublicLayout wide>
            <Home />
          </PublicLayout>
        }
      />
      <Route
        path="/agendar"
        element={
          <PublicLayout>
            <Book />
          </PublicLayout>
        }
      />
      <Route
        path="/entrar"
        element={
          <PublicLayout>
            <Login />
          </PublicLayout>
        }
      />
      <Route
        path="/conta"
        element={
          <PublicLayout>
            <Account />
          </PublicLayout>
        }
      />
      <Route
        path="/agendamento/:id"
        element={
          <PublicLayout>
            <MyBooking />
          </PublicLayout>
        }
      />
      <Route
        path="*"
        element={
          <PublicLayout>
            <NotFound />
          </PublicLayout>
        }
      />
    </Routes>
  );
}
