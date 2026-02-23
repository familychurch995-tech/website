/**
 * Family Church — Telegram Bot Admin (Cloudflare Worker)
 *
 * This worker receives Telegram webhook messages and manages events
 * on the church website by committing to the GitHub repo.
 *
 * Commands:
 *   /newevent    — Create a new event
 *   /editevent   — Edit an existing event
 *   /deleteevent — Delete an event
 *   /listevents  — List all events
 *   /help        — Show available commands
 *
 * Environment Variables (set in Cloudflare dashboard):
 *   TELEGRAM_BOT_TOKEN  — From @BotFather
 *   TELEGRAM_ADMIN_ID   — Your Telegram user ID (for security)
 *   GITHUB_TOKEN        — GitHub Personal Access Token (repo scope)
 *   GITHUB_REPO         — e.g. "familychurch995-tech/website"
 */

const EVENTS_PATH = 'data/events.json';
const BRANCH = 'main';

export default {
  async fetch(request, env) {
    if (request.method !== 'POST') {
      return new Response('OK', { status: 200 });
    }

    try {
      const update = await request.json();
      const message = update.message;
      if (!message || !message.text) return new Response('OK');

      const chatId = message.chat.id;
      const userId = message.from.id;
      const text = message.text.trim();

      // Security: only respond to the admin
      if (String(userId) !== String(env.TELEGRAM_ADMIN_ID)) {
        await sendTelegram(env, chatId, '⛔ Acesso negado. Apenas o admin pode usar este bot.');
        return new Response('OK');
      }

      // Route commands
      if (text.startsWith('/newevent')) {
        await handleNewEvent(env, chatId, text);
      } else if (text.startsWith('/editevent')) {
        await handleEditEvent(env, chatId, text);
      } else if (text.startsWith('/deleteevent')) {
        await handleDeleteEvent(env, chatId, text);
      } else if (text.startsWith('/listevents')) {
        await handleListEvents(env, chatId);
      } else if (text.startsWith('/help') || text.startsWith('/start')) {
        await handleHelp(env, chatId);
      } else {
        await sendTelegram(env, chatId, 'Use /help para ver os comandos disponíveis.');
      }

      return new Response('OK');
    } catch (err) {
      console.error('Worker error:', err);
      return new Response('Error', { status: 500 });
    }
  }
};

// ── Telegram API ──

async function sendTelegram(env, chatId, text) {
  await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: text,
      parse_mode: 'Markdown'
    })
  });
}

// ── GitHub API ──

async function getEventsFromGitHub(env) {
  const res = await fetch(
    `https://api.github.com/repos/${env.GITHUB_REPO}/contents/${EVENTS_PATH}?ref=${BRANCH}`,
    {
      headers: {
        'Authorization': `token ${env.GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'FamilyChurch-TelegramBot'
      }
    }
  );
  if (!res.ok) {
    if (res.status === 404) return { events: [], sha: null };
    throw new Error(`GitHub GET failed: ${res.status}`);
  }
  const data = await res.json();
  const content = atob(data.content.replace(/\n/g, ''));
  return { events: JSON.parse(content), sha: data.sha };
}

async function saveEventsToGitHub(env, events, sha, commitMessage) {
  const content = btoa(unescape(encodeURIComponent(JSON.stringify(events, null, 2) + '\n')));
  const body = {
    message: commitMessage,
    content: content,
    branch: BRANCH
  };
  if (sha) body.sha = sha;

  const res = await fetch(
    `https://api.github.com/repos/${env.GITHUB_REPO}/contents/${EVENTS_PATH}`,
    {
      method: 'PUT',
      headers: {
        'Authorization': `token ${env.GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'FamilyChurch-TelegramBot',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    }
  );
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`GitHub PUT failed: ${res.status} — ${err}`);
  }
}

// ── Command Handlers ──

async function handleHelp(env, chatId) {
  const helpText = `
🏠 *Family Church — Bot Admin*

Comandos disponíveis:

/newevent — Criar novo evento
Formato:
\`\`\`
/newevent
Title PT: Dons Digitais
Title EN: Digital Gifts
Date: 2026-03-15
Time: 7:00 PM
Description PT: Descrição em português...
Description EN: Description in English...
Status: upcoming
\`\`\`

/editevent — Editar evento existente
\`\`\`
/editevent
ID: dons-digitais-2026
Date: 2026-04-01
Time: 6:30 PM
\`\`\`

/deleteevent — Deletar evento
\`\`\`
/deleteevent dons-digitais-2026
\`\`\`

/listevents — Listar todos os eventos

/help — Mostrar esta mensagem
  `;
  await sendTelegram(env, chatId, helpText);
}

async function handleNewEvent(env, chatId, text) {
  try {
    // Parse the message
    const lines = text.split('\n').slice(1); // Skip the /newevent line
    const fields = parseFields(lines);

    if (!fields['title pt']) {
      await sendTelegram(env, chatId, '❌ Faltam campos. Envie pelo menos:\nTitle PT: ...\nTitle EN: ...\nDate: YYYY-MM-DD\n\nUse /help para ver o formato.');
      return;
    }

    const titlePt = fields['title pt'] || '';
    const titleEn = fields['title en'] || titlePt;
    const date = fields['date'] || 'TBD';
    const time = fields['time'] || 'TBD';
    const descPt = fields['description pt'] || fields['desc pt'] || '';
    const descEn = fields['description en'] || fields['desc en'] || descPt;
    const status = fields['status'] || 'upcoming';

    // Generate ID from title
    const id = titlePt.toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      + (date !== 'TBD' ? '-' + date.substring(0, 4) : '-2026');

    const newEvent = {
      id,
      title_en: titleEn,
      title_pt: titlePt,
      description_en: descEn,
      description_pt: descPt,
      date,
      time,
      location_en: 'Family Church — 18 Cushing Street, Stamford, CT',
      location_pt: 'Family Church — 18 Cushing Street, Stamford, CT',
      image: `images/events/${id}/cover.jpg`,
      photos: [],
      status
    };

    // Get current events and add the new one
    const { events, sha } = await getEventsFromGitHub(env);
    events.push(newEvent);

    await saveEventsToGitHub(env, events, sha, `Add event: ${titlePt}`);

    await sendTelegram(env, chatId, `✅ *Evento criado com sucesso!*\n\n📌 *${titlePt}*\n📅 ${date}\n🕐 ${time}\n🆔 ${id}\n\nO evento aparecerá no site em alguns minutos.`);
  } catch (err) {
    await sendTelegram(env, chatId, `❌ Erro ao criar evento: ${err.message}`);
  }
}

async function handleEditEvent(env, chatId, text) {
  try {
    const lines = text.split('\n').slice(1);
    const fields = parseFields(lines);
    const id = fields['id'];

    if (!id) {
      await sendTelegram(env, chatId, '❌ Informe o ID do evento.\n\nFormato:\n/editevent\nID: evento-id\nDate: 2026-04-01');
      return;
    }

    const { events, sha } = await getEventsFromGitHub(env);
    const idx = events.findIndex(e => e.id === id);

    if (idx === -1) {
      await sendTelegram(env, chatId, `❌ Evento "${id}" não encontrado.\n\nUse /listevents para ver os IDs.`);
      return;
    }

    // Update fields that were provided
    if (fields['title pt']) events[idx].title_pt = fields['title pt'];
    if (fields['title en']) events[idx].title_en = fields['title en'];
    if (fields['date']) events[idx].date = fields['date'];
    if (fields['time']) events[idx].time = fields['time'];
    if (fields['description pt'] || fields['desc pt']) events[idx].description_pt = fields['description pt'] || fields['desc pt'];
    if (fields['description en'] || fields['desc en']) events[idx].description_en = fields['description en'] || fields['desc en'];
    if (fields['status']) events[idx].status = fields['status'];

    await saveEventsToGitHub(env, events, sha, `Update event: ${events[idx].title_pt}`);

    await sendTelegram(env, chatId, `✅ *Evento atualizado!*\n\n📌 *${events[idx].title_pt}*\n📅 ${events[idx].date}\n🕐 ${events[idx].time}\n\nAs mudanças aparecerão no site em alguns minutos.`);
  } catch (err) {
    await sendTelegram(env, chatId, `❌ Erro ao editar evento: ${err.message}`);
  }
}

async function handleDeleteEvent(env, chatId, text) {
  try {
    const id = text.replace('/deleteevent', '').trim();

    if (!id) {
      await sendTelegram(env, chatId, '❌ Informe o ID do evento.\n\nFormato: /deleteevent evento-id');
      return;
    }

    const { events, sha } = await getEventsFromGitHub(env);
    const idx = events.findIndex(e => e.id === id);

    if (idx === -1) {
      await sendTelegram(env, chatId, `❌ Evento "${id}" não encontrado.\n\nUse /listevents para ver os IDs.`);
      return;
    }

    const removed = events.splice(idx, 1)[0];
    await saveEventsToGitHub(env, events, sha, `Delete event: ${removed.title_pt}`);

    await sendTelegram(env, chatId, `🗑️ *Evento deletado:* ${removed.title_pt}\n\nA mudança aparecerá no site em alguns minutos.`);
  } catch (err) {
    await sendTelegram(env, chatId, `❌ Erro ao deletar evento: ${err.message}`);
  }
}

async function handleListEvents(env, chatId) {
  try {
    const { events } = await getEventsFromGitHub(env);

    if (events.length === 0) {
      await sendTelegram(env, chatId, '📋 Nenhum evento encontrado.');
      return;
    }

    const list = events.map(e => {
      const icon = e.status === 'upcoming' ? '🔜' : '📸';
      return `${icon} *${e.title_pt}*\n   📅 ${e.date} | 🆔 \`${e.id}\``;
    }).join('\n\n');

    await sendTelegram(env, chatId, `📋 *Eventos:*\n\n${list}`);
  } catch (err) {
    await sendTelegram(env, chatId, `❌ Erro ao listar eventos: ${err.message}`);
  }
}

// ── Helpers ──

function parseFields(lines) {
  const fields = {};
  for (const line of lines) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.substring(0, colonIdx).trim().toLowerCase();
    const value = line.substring(colonIdx + 1).trim();
    if (key && value) fields[key] = value;
  }
  return fields;
}
