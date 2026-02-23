# Family Church — Telegram Bot Admin

Bot para gerenciar eventos do site da Family Church via Telegram.

## Setup (10 minutos)

### 1. Criar o Bot no Telegram
1. Abra o Telegram e procure `@BotFather`
2. Envie `/newbot`
3. Escolha um nome (ex: "Family Church Admin")
4. Escolha um username (ex: "familychurch_admin_bot")
5. Copie o **token** que o BotFather te dá

### 2. Descobrir seu Telegram User ID
1. Procure `@userinfobot` no Telegram
2. Envie qualquer mensagem
3. Ele responde com seu **User ID** (um número)

### 3. Criar um GitHub Personal Access Token
1. Vá em https://github.com/settings/tokens
2. "Generate new token (classic)"
3. Marque a permissão `repo` (full control)
4. Copie o token

### 4. Deploy no Cloudflare Workers
```bash
cd telegram-bot
npm install -g wrangler
wrangler login

# Configurar os secrets
npx wrangler secret put TELEGRAM_BOT_TOKEN
# (cola o token do BotFather)

npx wrangler secret put TELEGRAM_ADMIN_ID
# (cola seu User ID)

npx wrangler secret put GITHUB_TOKEN
# (cola o GitHub token)

npx wrangler secret put GITHUB_REPO
# (digita: familychurch995-tech/website)

# Deploy
npx wrangler deploy
```

### 5. Configurar o Webhook do Telegram
Depois do deploy, o Wrangler mostra a URL do worker (ex: `https://familychurch-telegram-bot.YOURACCOUNT.workers.dev`).

Configure o webhook:
```
https://api.telegram.org/bot<SEU_TOKEN>/setWebhook?url=https://familychurch-telegram-bot.YOURACCOUNT.workers.dev
```

Abra essa URL no navegador. Deve retornar `{"ok":true}`.

## Comandos do Bot

| Comando | Descrição |
|---------|-----------|
| `/newevent` | Criar novo evento |
| `/editevent` | Editar evento existente |
| `/deleteevent <id>` | Deletar evento |
| `/listevents` | Listar todos os eventos |
| `/help` | Mostrar ajuda |

### Exemplo: Criar Evento
```
/newevent
Title PT: Noite de Oração
Title EN: Prayer Night
Date: 2026-03-15
Time: 7:00 PM
Description PT: Venha orar conosco...
Description EN: Come pray with us...
Status: upcoming
```

### Exemplo: Editar Evento
```
/editevent
ID: noite-de-oracao-2026
Date: 2026-03-20
Time: 8:00 PM
```

### Exemplo: Deletar Evento
```
/deleteevent noite-de-oracao-2026
```
