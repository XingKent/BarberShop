FROM node:22-alpine AS base
WORKDIR /app
COPY package*.json ./

# Desenvolvimento: recarrega ao salvar (código montado pelo docker-compose).
FROM base AS dev
RUN npm ci
COPY . .
EXPOSE 3000
CMD ["sh", "-c", "npm run db:migrate && npm run dev"]

FROM base AS build
RUN npm ci
COPY . .
RUN npm run build

# Produção: só dependências de runtime e o código compilado.
FROM node:22-alpine AS prod
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY drizzle ./drizzle
# Sem privilégios de administrador dentro do container.
USER node
EXPOSE 3000
CMD ["sh", "-c", "node dist/db/migrate.js && node dist/server.js"]
