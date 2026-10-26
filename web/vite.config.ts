import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Em desenvolvimento, /api é encaminhado para a API (localmente ou, no Docker, para o serviço "api").
const apiTarget = process.env.API_PROXY_TARGET ?? "http://localhost:3000";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // changeOrigin: false mantém o Host que o navegador usou (ex.: o IP do PC na rede). A API compara
    // Host com Origin para aceitar pedidos do próprio site, inclusive abertos pelo celular.
    // xfwd: repassa o IP de quem acessou (o limite de tentativas da API conta por IP).
    proxy: { "/api": { target: apiTarget, changeOrigin: false, xfwd: true } },
  },
});
