import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { auth, type Me } from "./api";

interface AuthState {
  /** true até a primeira resposta de "quem está logado". */
  loading: boolean;
  user: Me["user"];
  customer: Me["customer"];
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState>({
  loading: true,
  user: null,
  customer: null,
  refresh: async () => {},
  logout: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<Me["user"]>(null);
  const [customer, setCustomer] = useState<Me["customer"]>(null);

  const refresh = useCallback(async () => {
    try {
      const me = await auth.me();
      setUser(me.user);
      setCustomer(me.customer);
    } catch {
      setUser(null);
      setCustomer(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await auth.logout();
    } finally {
      setUser(null);
      setCustomer(null);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo(
    () => ({ loading, user, customer, refresh, logout }),
    [loading, user, customer, refresh, logout],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
