FROM node:22-alpine AS base
WORKDIR /app
COPY package*.json ./

# Desenvolvimento: Vite com recarga ao salvar (código montado pelo docker-compose).
FROM base AS dev
RUN npm ci
COPY . .
EXPOSE 5173
CMD ["npm", "run", "dev"]

FROM base AS build
RUN npm ci
COPY . .
RUN npm run build

# Produção: arquivos estáticos no nginx, com /api encaminhado para o serviço "api".
FROM nginx:1.27-alpine AS prod
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
