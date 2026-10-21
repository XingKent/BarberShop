import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { ApiError } from "../../api";

export const AdminCtx = createContext<{ logout: () => void }>({ logout: () => {} });

/** Carrega dados do painel; uma resposta 401 desloga o usuário. */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[]) {
  const { logout } = useContext(AdminCtx);
  const [data, setData] = useState<T>();
  const [error, setError] = useState("");
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let alive = true;
    setError("");
    fn()
      .then((d) => alive && setData(d))
      .catch((e: unknown) => {
        if (!alive) return;
        if (e instanceof ApiError && e.status === 401) logout();
        else setError(e instanceof Error ? e.message : "Algo deu errado.");
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { data, error, reload };
}

export function useAdminAction() {
  const { logout } = useContext(AdminCtx);
  return useCallback(
    (e: unknown): string => {
      if (e instanceof ApiError && e.status === 401) {
        logout();
        return "";
      }
      return e instanceof Error ? e.message : "Algo deu errado.";
    },
    [logout],
  );
}

export const minToHHMM = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

export const hhmmToMin = (s: string) => {
  const [h, m] = s.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

export const WEEKDAYS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
