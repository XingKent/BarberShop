# Barbearia

Sistema de agendamento para barbearia: o cliente cria uma conta, reserva o horário pelo celular e recebe os avisos por e-mail. O dono administra agenda, cadastros e faturamento.

- **Cliente**: página inicial com serviços e preços (`/`), agendamento em 4 passos (`/agendar`), conta com login, histórico e opção de excluir a conta (`/conta`).
- **Avisos por e-mail**: confirmação ao reservar, aviso quando a barbearia confirma ou cancela, e **lembrete 2 horas antes** do horário.
- **Dono** (`/admin`): agenda do dia (confirmar, concluir, cancelar), faturamento por período, barbeiro e serviço, cadastro de serviços, barbeiros (com foto enviada do celular ou do computador) e horários de trabalho, lista de clientes.

## Stack

| Parte | Tecnologia |
| --- | --- |
| Front (`web/`) | React 19, TypeScript, Vite, React Router. CSS próprio, mobile first |
| API (`api/`) | Node 22, Express 5, TypeScript, Zod, Nodemailer |
| Banco | PostgreSQL 16, Drizzle ORM (migrations em `api/drizzle`, aplicadas sozinhas ao subir a API) |
| Infra | Docker Compose (com Mailpit para testar e-mails), GitHub Actions |

## Rodar com Docker

```bash
cp .env.example .env     # no Windows: copy .env.example .env
```

Abra o `.env` e preencha `OWNER_EMAIL` e `OWNER_PASSWORD` (10 caracteres ou mais). Depois:

```bash
docker compose up --build
docker compose exec api npm run db:seed    # opcional: 3 serviços e 2 barbeiros de exemplo
```

| O que | Endereço |
| --- | --- |
| Site do cliente | http://localhost:5173 |
| Painel do dono | http://localhost:5173/admin |
| Caixa de e-mail de teste (Mailpit) | http://localhost:8025 |
| API | http://localhost:3000/health |

**Os e-mails não saem de verdade no ambiente de teste.** Todos (código de confirmação, reserva, lembrete) caem no Mailpit, em http://localhost:8025. É lá que você pega o código de 6 números ao criar uma conta.

### Primeiro acesso do dono

1. Abra `/admin` e entre com `OWNER_EMAIL` e `OWNER_PASSWORD`.
2. Na primeira vez, o sistema mostra um QR code. Escaneie com um aplicativo autenticador no celular (Google Authenticator, Microsoft Authenticator ou Authy) e digite o código de 6 números.
3. Nas próximas entradas: e-mail, senha e o código do aplicativo.

A conta do dono só é criada na primeira vez que a API sobe. Trocar `OWNER_PASSWORD` no `.env` depois não muda a senha.

### Atualizando a partir da versão anterior

1. Substitua os arquivos do projeto pelos novos (mantenha o seu `.env`).
2. No `.env`, apague `ADMIN_TOKEN` e acrescente `OWNER_EMAIL` e `OWNER_PASSWORD` (veja `.env.example`).
3. Rode `docker compose up --build`. As migrations atualizam o banco sem perder clientes nem agendamentos.

Os links de cancelamento de agendamentos feitos antes da atualização deixam de funcionar. Os agendamentos continuam na agenda do dono.

## Como funcionam os avisos

- **Reserva**: ao confirmar, a pessoa recebe "Horário reservado" com um link para ver ou cancelar sem precisar entrar na conta.
- **Confirmação e cancelamento pela barbearia**: quando o dono muda o status na agenda, o cliente recebe o aviso.
- **Lembrete 2 horas antes**: a API confere a cada minuto os horários que começam em até 2 horas e envia um lembrete por agendamento, uma única vez, mesmo com mais de uma cópia da API rodando. Quem reservou com menos de 2 horas de antecedência não recebe lembrete (acabou de receber a confirmação). **A API precisa estar no ar** para os lembretes saírem.
- **Falha no envio** não derruba a reserva: o horário fica gravado e o erro aparece no log da API. Se o lembrete falhar, ele é tentado de novo no minuto seguinte.
- **WhatsApp**: ainda não. O envio é feito por "canais" (`api/src/notifications.ts`), então acrescentar um canal de WhatsApp depois não mexe no resto. Exige uma conta em um provedor, como a API oficial do WhatsApp Business.

### Enviar e-mails de verdade

Defina no `.env` o servidor de e-mail do seu provedor (Resend, Brevo, Amazon SES, Gmail com senha de app etc.):

```
SMTP_URL=smtp://usuario:senha@smtp.seuprovedor.com:587
MAIL_FROM=Barbearia <contato@seudominio.com.br>
APP_URL=https://seu-site.com.br
```

`APP_URL` é o endereço público do site, usado nos links dos e-mails. Com HTTPS, defina também `COOKIE_SECURE=true`. Para os e-mails não caírem no spam, o provedor pede que você confirme o domínio de envio (SPF e DKIM).

## Foto dos barbeiros

No painel, em **Cadastros → Barbeiros → Foto**, escolha uma imagem (JPEG, PNG ou WebP). O navegador corta em quadrado e reduz para 512 px antes de enviar (fica em poucas dezenas de KB). A API confere o tipo pelo conteúdo do arquivo, recusa mais de 600 KB e guarda a foto no banco, numa tabela própria.

## Excluir a conta

Em `/conta`, **Excluir minha conta** pede a senha. Saem e-mail, senha, sessões, nome e celular. Os horários futuros são cancelados e voltam a ficar livres. Os atendimentos já feitos ficam, sem identificar ninguém, para o faturamento do dono não mudar. A conta do dono não é excluída por essa tela.

## Abrir pelo celular (mesma rede Wi-Fi)

Use `http://IP-DO-PC:5173` (no Windows, `ipconfig`, campo "Endereço IPv4"). O Windows pode perguntar sobre o firewall: permita redes privadas. Se aparecer "Origem não permitida", o container do front está com a configuração antiga: rode `docker compose up --build` uma vez.

## Login e segurança

- **Cliente**: e-mail e senha (8 caracteres ou mais). No cadastro, o e-mail é confirmado com um código de 6 números, para os avisos irem para o dono do e-mail. Esqueceu a senha: código por e-mail.
- **Dono**: e-mail, senha (10 ou mais) e código do aplicativo autenticador. O painel mostra faturamento e dados dos clientes, por isso tem a segunda etapa.
- Senhas guardadas com hash (scrypt). Sessão em cookie `HttpOnly`, sem token no JavaScript. Depois de 5 senhas erradas, a conta trava por 15 minutos. Pedidos que alteram dados só valem vindos do próprio site (o Host do pedido precisa ser o mesmo da origem, por isso o proxy do Vite não pode trocar o Host).
- Trocar a senha encerra as sessões abertas da conta.
- **Limite por IP**: 30 pedidos a cada 15 min onde dá para adivinhar senha, código ou 2FA, e 10 por hora onde o sistema manda e-mail para um endereço informado (cadastro, reenvio, "esqueci a senha"). `RATE_LIMIT=off` desliga (demonstrações). Atrás de nginx ou balanceador, `TRUST_PROXY_HOPS` (padrão 1) diz quantos servidores existem entre o visitante e a API, para contar o IP certo; use 0 se a API ficar exposta direto.
- **Reservas**: no máximo 3 horários futuros por pessoa e até 60 dias de antecedência, para uma conta não segurar a agenda inteira.
- **HTTPS**: o cookie de sessão passa a exigir HTTPS sozinho quando `APP_URL` começa com `https://`.
- O nginx de produção envia cabeçalhos de segurança (CSP, bloqueio de iframe, sem referrer). A API de produção roda sem root e, no Docker de desenvolvimento, só aceita conexões do próprio computador.

### Auditoria de segurança

Os ataques abaixo viraram testes (`api/src/security.test.ts`) e precisam continuar sendo barrados: acessar o painel sem login ou como cliente, usar a sessão curta do 2FA como dono, ver ou cancelar o horário de outra pessoa (conta e link), campos extras no cadastro, tomar a conta do dono, cookie malformado, injeção de SQL/NoSQL, upload de SVG/HTML, força bruta de senha e de código, enchimento de caixa de e-mail e reserva em massa.

Não coberto por esta versão: o bloqueio de 5 senhas erradas pode ser usado por outra pessoa para travar uma conta por 15 minutos (a troca é proposital: protege a senha), o cadastro informa se um e-mail já tem conta, e o limite por IP fica na memória de cada cópia da API.

## Rodar sem Docker

Precisa de Node 22 e de um PostgreSQL acessível.

```bash
# API
cd api && npm install
export DATABASE_URL=postgresql://barbearia:barbearia@localhost:5432/barbearia
export OWNER_EMAIL=dono@exemplo.com OWNER_PASSWORD=uma-senha-longa-aqui
npm run db:migrate && npm run db:seed
npm run dev                    # http://localhost:3000 (sem SMTP_URL, os e-mails aparecem no log)

# Front (outro terminal)
cd web && npm install && npm run dev   # http://localhost:5173, com proxy de /api para a API
```

## Testes

```bash
cd api
npm test            # horários, API completa, login, e-mails, lembretes e migrations
npm run typecheck
cd ../web && npm run build   # tipos + build do front
```

Os testes da API não precisam de banco instalado: aplicam as migrations reais num Postgres embutido (PGlite). Um deles cria o banco na versão antiga, com dados, e confere que as migrations novas não perdem nada.

## Como o agendamento funciona

- Cada barbeiro tem horário de trabalho por dia da semana. Dia sem registro é folga.
- Os horários livres saem de `api/src/availability.ts`: início a cada 15 minutos, o serviço precisa caber no expediente, não pode sobrepor outro agendamento e exige 30 minutos de antecedência.
- Ao reservar, a API trava o barbeiro com um advisory lock do Postgres e confere o horário de novo. Duas pessoas no mesmo horário: a primeira vence, a segunda recebe "horário indisponível".
- O preço é copiado para o agendamento: mudar o preço depois não altera o faturamento passado.
- Status: `PENDING → CONFIRMED → COMPLETED`, com cancelamento até confirmado. O faturamento soma só `COMPLETED`.
- Fuso fixo em -03:00 (Brasil, sem horário de verão).

## API

Conta: `POST /api/auth/register`, `/auth/email/verify`, `/auth/email/resend`, `/auth/login`, `/auth/logout`, `/auth/password/forgot`, `/auth/password/reset`, `GET /auth/me`, `PATCH /auth/profile`. Dono: `/auth/owner/login`, `/auth/owner/totp/setup`, `/auth/owner/totp/enable`.

Cliente: `GET /api/services`, `/barbers`, `/availability?date=AAAA-MM-DD&serviceId=1[&barberId=1]`, `POST /appointments` (logado), `GET /me/appointments`, `POST /me/appointments/:id/cancel`, e `GET|POST /appointments/:id[/cancel]?token=…` para o link do e-mail.

Painel (só dono): `/api/admin/appointments`, `/services`, `/barbers`, `/barbers/:id/hours`, `/customers`, `/reports/revenue?from=…&to=…`.

## Imagens de produção

`api/Dockerfile` e `web/Dockerfile` têm um alvo `prod`: a API roda as migrations e sobe compilada; o front vira arquivos estáticos no nginx, que encaminha `/api` para o serviço `api`. Ainda não há `docker-compose` de produção.

## Limites desta versão

- **Sem WhatsApp nem SMS** (veja acima).
- **Sem pagamento online**, nem folgas pontuais (feriados, férias): hoje só dá para editar a grade semanal.
- **Um dono só.** Para mais de uma pessoa administrando, é preciso acrescentar contas de equipe.
- **Perdeu o aplicativo autenticador?** Não há recuperação pela tela. É preciso zerar o autenticador do dono direto no banco.
- O lembrete depende da API estar rodando o tempo todo (um computador ligado ou um servidor).
