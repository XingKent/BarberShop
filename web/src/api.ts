export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    /** Código estável enviado pela API (ex.: TOTP_REQUIRED). */
    public code?: string,
  ) {
    super(message);
  }
}

// O login usa um cookie que o servidor define e o navegador envia sozinho (mesma origem),
// então não há token guardado aqui no JavaScript.
async function request<T>(
  path: string,
  opts: { method?: string; body?: unknown; /** Arquivo enviado como está (ex.: foto). */ raw?: Blob } = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  let body: BodyInit | undefined;
  if (opts.raw) {
    headers["content-type"] = opts.raw.type;
    body = opts.raw;
  } else if (opts.body !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(opts.body);
  }

  let res: Response;
  try {
    res = await fetch(`/api${path}`, { method: opts.method ?? "GET", headers, body });
  } catch {
    throw new ApiError(0, "Sem conexão com o servidor. Verifique sua internet e tente de novo.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const issue = Array.isArray(data.issues) && data.issues[0]?.message;
    throw new ApiError(res.status, issue || data.error || "Algo deu errado. Tente de novo.", data.code);
  }
  return data as T;
}

// ---- Tipos ----
export interface Service {
  id: number;
  name: string;
  durationMin: number;
  priceCents: number;
  active?: boolean;
}
export interface Barber {
  id: number;
  name: string;
  active?: boolean;
  photoUrl?: string | null;
  hours?: { weekday: number; startMin: number; endMin: number }[];
}
export interface Slot {
  barberId: number;
  barberName: string;
  time: string;
  startsAt: string;
}
export type Status = "PENDING" | "CONFIRMED" | "CANCELED" | "COMPLETED";
export interface AdminAppointment {
  id: number;
  startsAt: string;
  endsAt: string;
  status: Status;
  priceCents: number;
  service: string;
  barberId: number;
  barber: string;
  customer: string;
  phone: string;
}
export interface MyAppointment {
  id: number;
  startsAt: string;
  endsAt: string;
  status: Status;
  priceCents: number;
  service: string;
  barber: string;
  customer: string;
}
export interface AccountAppointment {
  id: number;
  startsAt: string;
  endsAt: string;
  status: Status;
  priceCents: number;
  service: string;
  barber: string;
}
export interface Revenue {
  from: string;
  to: string;
  totalCents: number;
  count: number;
  averageTicketCents: number;
  byDay: { date: string; totalCents: number; count: number }[];
  byBarber: { barberId: number; name: string; totalCents: number; count: number }[];
  byService: { serviceId: number; name: string; totalCents: number; count: number }[];
}
export interface Customer {
  id: number;
  name: string;
  phone: string;
  email: string | null;
  appointments: number;
}
export interface SessionUser {
  id: number;
  email: string;
  role: "CLIENT" | "OWNER";
}
export interface Me {
  user: SessionUser | null;
  customer: { name: string; phone: string } | null;
}

// ---- Público ----
export const api = {
  services: () => request<Service[]>("/services"),
  barbers: () => request<Barber[]>("/barbers"),
  availability: (p: { date: string; serviceId: number; barberId?: number }) =>
    request<{ date: string; durationMin: number; slots: Slot[] }>(
      `/availability?date=${p.date}&serviceId=${p.serviceId}${p.barberId ? `&barberId=${p.barberId}` : ""}`,
    ),
  book: (body: { serviceId: number; barberId: number; startsAt: string }) =>
    request<{ id: number; cancelToken: string; startsAt: string; endsAt: string; status: Status }>(
      "/appointments",
      { method: "POST", body },
    ),
  myAppointment: (id: number, token: string) =>
    request<MyAppointment>(`/appointments/${id}?token=${encodeURIComponent(token)}`),
  cancelMine: (id: number, token: string) =>
    request<{ id: number; status: Status }>(`/appointments/${id}/cancel`, {
      method: "POST",
      body: { token },
    }),
};

// ---- Login e conta ----
export const auth = {
  me: () => request<Me>("/auth/me"),
  register: (body: { name: string; phone: string; email: string; password: string }) =>
    request<{ needsVerification: true }>("/auth/register", { method: "POST", body }),
  resendCode: (email: string) =>
    request<{ ok: true }>("/auth/email/resend", { method: "POST", body: { email } }),
  verifyEmail: (email: string, code: string) =>
    request<{ user: SessionUser }>("/auth/email/verify", { method: "POST", body: { email, code } }),
  login: (email: string, password: string) =>
    request<{ user: SessionUser }>("/auth/login", { method: "POST", body: { email, password } }),
  forgotPassword: (email: string) =>
    request<{ ok: true }>("/auth/password/forgot", { method: "POST", body: { email } }),
  resetPassword: (body: { email: string; code: string; password: string }) =>
    request<{ ok: true }>("/auth/password/reset", { method: "POST", body }),
  updateProfile: (body: { name: string; phone: string }) =>
    request<{ customer: { name: string; phone: string } }>("/auth/profile", { method: "PATCH", body }),
  logout: () => request<{ ok: true }>("/auth/logout", { method: "POST", body: {} }),
  /** Exclui a conta do cliente (pede a senha). Os horários futuros são cancelados. */
  deleteAccount: (password: string) =>
    request<{ ok: true }>("/auth/account", { method: "DELETE", body: { password } }),
  ownerLogin: (body: { email: string; password: string; totp?: string }) =>
    request<{ user?: SessionUser; needsTotpSetup?: boolean }>("/auth/owner/login", {
      method: "POST",
      body,
    }),
  totpSetup: () => request<{ secret: string; uri: string }>("/auth/owner/totp/setup"),
  totpEnable: (code: string) =>
    request<{ user: SessionUser }>("/auth/owner/totp/enable", { method: "POST", body: { code } }),
};

export const account = {
  appointments: () => request<AccountAppointment[]>("/me/appointments"),
  cancel: (id: number) =>
    request<{ id: number; status: Status }>(`/me/appointments/${id}/cancel`, {
      method: "POST",
      body: {},
    }),
};

// ---- Painel ----
export const admin = {
  appointments: (p: { from: string; to?: string }) =>
    request<AdminAppointment[]>(`/admin/appointments?from=${p.from}${p.to ? `&to=${p.to}` : ""}`),
  setStatus: (id: number, status: Status) =>
    request(`/admin/appointments/${id}`, { method: "PATCH", body: { status } }),
  revenue: (from: string, to: string) =>
    request<Revenue>(`/admin/reports/revenue?from=${from}&to=${to}`),
  services: () => request<Service[]>("/admin/services"),
  addService: (body: { name: string; durationMin: number; priceCents: number }) =>
    request<Service>("/admin/services", { method: "POST", body }),
  updateService: (id: number, body: { active: boolean }) =>
    request<Service>(`/admin/services/${id}`, { method: "PATCH", body }),
  barbers: () => request<Barber[]>("/admin/barbers"),
  addBarber: (name: string, photoUrl?: string) =>
    request<Barber>("/admin/barbers", {
      method: "POST",
      body: { name, ...(photoUrl ? { photoUrl } : {}) },
    }),
  updateBarber: (id: number, body: { active?: boolean; photoUrl?: string }) =>
    request<Barber>(`/admin/barbers/${id}`, { method: "PATCH", body }),
  uploadBarberPhoto: (id: number, photo: Blob) =>
    request<{ photoUrl: string }>(`/admin/barbers/${id}/photo`, { method: "PUT", raw: photo }),
  deleteBarberPhoto: (id: number) =>
    request<{ photoUrl: null }>(`/admin/barbers/${id}/photo`, { method: "DELETE" }),
  setHours: (id: number, hours: { weekday: number; startMin: number; endMin: number }[]) =>
    request(`/admin/barbers/${id}/hours`, { method: "PUT", body: hours }),
  customers: () => request<Customer[]>("/admin/customers"),
};
