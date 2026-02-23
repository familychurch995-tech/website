/**
 * Family Church — Telegram Bot Admin (Cloudflare Worker)
 *
 * Manages events on the church website via Telegram messages.
 * Supports both structured commands AND natural language (via Workers AI).
 *
 * Structured Commands:
 *   /newevent    — Create a new event (key: value format)
 *   /editevent   — Edit an existing event
 *   /deleteevent — Delete an event
 *   /listevents  — List all events
 *   /help        — Show available commands
 *   /sim         — Confirm a pending AI-parsed action
 *   /nao         — Cancel a pending action
 *
 * Natural Language:
 *   Just type in Portuguese or English, e.g.:
 *   "Cria um evento noite de oração dia 15 de março às 7pm"
 *   The AI parses it and asks for confirmation before committing.
 *
 * Environment Variables:
 *   TELEGRAM_BOT_TOKEN  — From @BotFather
 *   TELEGRAM_ADMIN_ID   — Your Telegram user ID (for security)
 *   GITHUB_TOKEN        — GitHub Personal Access Token (Contents R/W)
 *   GITHUB_REPO         — e.g. "familychurch995-tech/website"
 *
 * Bindings:
 *   AI — Workers AI binding (for natural language parsing)
 */

const EVENTS_PATH = 'data/events.json';
const BRANCH = 'main';

// In-memory store for pending confirmations (per-worker instance)
// In production, this resets on cold starts, which is fine — user just re-sends
const pendingActions = new Map();

export default {
  async fetch(request, env) {
    if (request.method !== 'POST') {
      return new Response('OK', { status: 200 });
    }

    try {
      const update = await request.json();
      const message = update.message;
      if (!message) return new Response('OK');

      const chatId = message.chat.id;
      const userId = message.from.id;

      // Handle photo messages (with or without caption)
      if (message.photo && message.photo.length > 0) {
        if (String(userId) !== String(env.TELEGRAM_ADMIN_ID)) {
          await sendTelegram(env, chatId, '⛔ Acesso negado.');
          return new Response('OK');
        }
        await handlePhotoUpload(env, chatId, message);
        return new Response('OK');
      }

      if (!message.text) return new Response('OK');
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
      } else if (text === '/sim' || text === '/yes') {
        await handleConfirm(env, chatId);
      } else if (text === '/nao' || text === '/no' || text === '/cancelar') {
        await handleCancel(env, chatId);
      } else if (!text.startsWith('/')) {
        // Check if there's a pending photo waiting for an event ID
        const pending = pendingActions.get(String(chatId));
        if (pending && pending.action === 'photo_waiting') {
          await handlePhotoEventId(env, chatId, text, pending.fileId);
        } else {
          // Natural language — send to AI
          await handleNaturalLanguage(env, chatId, text);
        }
      } else {
        await sendTelegram(env, chatId, 'Comando não reconhecido. Use /help para ver os comandos.');
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

// ── Workers AI — Natural Language Parsing ──

const AI_SYSTEM_PROMPT = `You are a helpful assistant for Family Church (a Brazilian church in Stamford, CT).
Your job is to parse the admin's natural language message into a structured event action.

The current year is 2026. The church is at 18 Cushing Street, Stamford, CT.

Return ONLY valid JSON (no markdown, no explanation) in this exact format:
{
  "action": "create" | "edit" | "delete" | "list" | "unknown",
  "title_pt": "Título em português",
  "title_en": "Title in English",
  "description_pt": "Descrição em português",
  "description_en": "Description in English",
  "date": "YYYY-MM-DD" or "TBD",
  "time": "HH:MM AM/PM" or "TBD",
  "status": "upcoming",
  "event_id": "only for edit/delete actions"
}

Rules:
- If the message is in Portuguese, generate both PT and EN versions (translate the title and description)
- If the message is in English, generate both EN and PT versions
- For dates, convert natural language to YYYY-MM-DD format
- For times, use 12-hour format with AM/PM
- If a field is not mentioned, use "TBD" for date/time or leave description empty
- For the description, write 2-3 sentences expanding on what the admin said, making it sound inviting
- If the message is about listing events, use action "list"
- If the message is about deleting, use action "delete" and include the event_id if mentioned
- If you can't understand the intent, use action "unknown"`;

async function handleNaturalLanguage(env, chatId, text) {
  try {
    const response = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
      messages: [
        { role: 'system', content: AI_SYSTEM_PROMPT },
        { role: 'user', content: text }
      ],
      max_tokens: 512,
      temperature: 0.3
    });

    const aiText = response.response || '';

    // Try to extract JSON from the response
    let parsed;
    try {
      // Handle cases where AI wraps in markdown code blocks
      const jsonMatch = aiText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON found');
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      await sendTelegram(env, chatId, '🤔 Não entendi. Tente descrever o que quer fazer com mais detalhes, ou use /help para ver os comandos estruturados.');
      return;
    }

    if (parsed.action === 'unknown') {
      await sendTelegram(env, chatId, '🤔 Não entendi o que você quer fazer. Tente algo como:\n\n"Cria um evento noite de oração dia 15 de março às 7pm"\n\nOu use /help para ver os comandos.');
      return;
    }

    if (parsed.action === 'list') {
      await handleListEvents(env, chatId);
      return;
    }

    if (parsed.action === 'delete') {
      if (parsed.event_id) {
        // Store pending delete and ask for confirmation
        pendingActions.set(String(chatId), { action: 'delete', event_id: parsed.event_id });
        await sendTelegram(env, chatId, `🗑️ *Deletar evento:* \`${parsed.event_id}\`\n\n✅ /sim para confirmar\n❌ /nao para cancelar`);
      } else {
        await sendTelegram(env, chatId, '❌ Qual evento deletar? Informe o ID.\n\nUse /listevents para ver os IDs.');
      }
      return;
    }

    // Create or edit — build preview and store pending action
    const titlePt = parsed.title_pt || 'Sem título';
    const titleEn = parsed.title_en || titlePt;
    const date = parsed.date || 'TBD';
    const time = parsed.time || 'TBD';
    const descPt = parsed.description_pt || '';
    const descEn = parsed.description_en || descPt;
    const status = parsed.status || 'upcoming';

    const id = titlePt.toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      + (date !== 'TBD' ? '-' + date.substring(0, 4) : '-2026');

    const eventData = {
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

    // Store pending action
    pendingActions.set(String(chatId), {
      action: parsed.action === 'edit' ? 'edit' : 'create',
      event: eventData
    });

    // Send preview
    const actionLabel = parsed.action === 'edit' ? 'Editar' : 'Criar';
    const preview = `🤖 *${actionLabel} evento:*\n\n📌 *${titlePt}*\n🇺🇸 ${titleEn}\n📅 ${date}\n🕐 ${time}\n📝 ${descPt.substring(0, 120)}${descPt.length > 120 ? '...' : ''}\n🆔 \`${id}\`\n\n✅ /sim para confirmar\n❌ /nao para cancelar`;

    await sendTelegram(env, chatId, preview);

  } catch (err) {
    console.error('AI parsing error:', err);
    await sendTelegram(env, chatId, `❌ Erro ao processar: ${err.message}\n\nTente usar /help para ver os comandos estruturados.`);
  }
}

// ── Photo Upload Handler ──

async function handlePhotoUpload(env, chatId, message) {
  try {
    const caption = (message.caption || '').trim();

    // Get highest resolution photo (last in the array)
    const photo = message.photo[message.photo.length - 1];
    const fileId = photo.file_id;

    // If no caption, ask which event the photo is for
    if (!caption) {
      // Store the file_id so we can retrieve it later
      pendingActions.set(String(chatId), { action: 'photo_waiting', fileId });
      const { events } = await getEventsFromGitHub(env);
      if (events.length === 0) {
        await sendTelegram(env, chatId, '❌ Nenhum evento encontrado. Crie um evento primeiro com /newevent.');
        pendingActions.delete(String(chatId));
        return;
      }
      const list = events.map(e => `🆔 \`${e.id}\`\n   📌 ${e.title_pt}`).join('\n\n');
      await sendTelegram(env, chatId, `📸 Foto recebida!\n\nPara qual evento é essa foto? Envie o ID:\n\n${list}\n\nOu digite o ID do evento:`);
      return;
    }

    // Caption provided — try to match it to an event
    const { events } = await getEventsFromGitHub(env);
    let targetEvent = null;

    // First try: exact ID match in caption
    targetEvent = events.find(e => caption.toLowerCase().includes(e.id));

    // Second try: title match
    if (!targetEvent) {
      const captionLower = caption.toLowerCase();
      targetEvent = events.find(e =>
        captionLower.includes(e.title_pt.toLowerCase()) ||
        captionLower.includes(e.title_en.toLowerCase())
      );
    }

    // Third try: use AI to parse the caption
    if (!targetEvent && events.length > 0) {
      try {
        const eventList = events.map(e => `ID: ${e.id}, Title: ${e.title_pt}`).join('\n');
        const aiResponse = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
          messages: [
            {
              role: 'system',
              content: `You match a user's caption to an event. Return ONLY the event ID (nothing else). Available events:\n${eventList}\n\nIf no match, return "none".`
            },
            { role: 'user', content: caption }
          ],
          max_tokens: 100,
          temperature: 0.1
        });
        const matchedId = (aiResponse.response || '').trim().toLowerCase();
        targetEvent = events.find(e => e.id === matchedId);
      } catch {
        // AI failed, fall back to asking
      }
    }

    if (!targetEvent) {
      // Store photo and ask
      pendingActions.set(String(chatId), { action: 'photo_waiting', fileId });
      const list = events.map(e => `🆔 \`${e.id}\`\n   📌 ${e.title_pt}`).join('\n\n');
      await sendTelegram(env, chatId, `📸 Foto recebida, mas não consegui identificar o evento.\n\nEnvie o ID do evento:\n\n${list}`);
      return;
    }

    // We have a target event — upload the photo
    await uploadPhotoToGitHub(env, chatId, fileId, targetEvent);

  } catch (err) {
    console.error('Photo upload error:', err);
    await sendTelegram(env, chatId, `❌ Erro ao processar foto: ${err.message}`);
  }
}

async function handlePhotoEventId(env, chatId, text, fileId) {
  pendingActions.delete(String(chatId));
  const { events } = await getEventsFromGitHub(env);
  const input = text.trim().toLowerCase();

  // Try to find event by ID or partial title match
  let targetEvent = events.find(e => e.id === input);
  if (!targetEvent) {
    targetEvent = events.find(e =>
      e.id.includes(input) ||
      e.title_pt.toLowerCase().includes(input) ||
      e.title_en.toLowerCase().includes(input)
    );
  }

  if (!targetEvent) {
    await sendTelegram(env, chatId, `❌ Evento "${text}" não encontrado.\n\nUse /listevents para ver os IDs e envie a foto novamente.`);
    return;
  }

  await uploadPhotoToGitHub(env, chatId, fileId, targetEvent);
}

async function uploadPhotoToGitHub(env, chatId, fileId, event) {
  await sendTelegram(env, chatId, `⏳ Fazendo upload da foto para *${event.title_pt}*...`);

  // 1. Get file path from Telegram
  const fileRes = await fetch(
    `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getFile?file_id=${fileId}`
  );
  const fileData = await fileRes.json();
  if (!fileData.ok || !fileData.result.file_path) {
    await sendTelegram(env, chatId, '❌ Não consegui obter o arquivo do Telegram.');
    return;
  }

  // 2. Download the photo from Telegram
  const downloadUrl = `https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${fileData.result.file_path}`;
  const imageRes = await fetch(downloadUrl);
  if (!imageRes.ok) {
    await sendTelegram(env, chatId, '❌ Não consegui baixar a foto do Telegram.');
    return;
  }
  const imageBuffer = await imageRes.arrayBuffer();
  const base64Image = btoa(String.fromCharCode(...new Uint8Array(imageBuffer)));

  // Determine file extension from Telegram's file_path
  const tgPath = fileData.result.file_path;
  const ext = tgPath.includes('.png') ? 'png' : 'jpg';
  const imagePath = `images/events/${event.id}/cover.${ext}`;

  // 3. Check if file already exists on GitHub (to get SHA for update)
  let existingSha = null;
  try {
    const checkRes = await fetch(
      `https://api.github.com/repos/${env.GITHUB_REPO}/contents/${imagePath}?ref=${BRANCH}`,
      {
        headers: {
          'Authorization': `token ${env.GITHUB_TOKEN}`,
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'FamilyChurch-TelegramBot'
        }
      }
    );
    if (checkRes.ok) {
      const existing = await checkRes.json();
      existingSha = existing.sha;
    }
  } catch {
    // File doesn't exist yet, that's fine
  }

  // 4. Upload to GitHub
  const uploadBody = {
    message: `${existingSha ? 'Update' : 'Add'} cover image for: ${event.title_pt}`,
    content: base64Image,
    branch: BRANCH
  };
  if (existingSha) uploadBody.sha = existingSha;

  const uploadRes = await fetch(
    `https://api.github.com/repos/${env.GITHUB_REPO}/contents/${imagePath}`,
    {
      method: 'PUT',
      headers: {
        'Authorization': `token ${env.GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'FamilyChurch-TelegramBot',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(uploadBody)
    }
  );

  if (!uploadRes.ok) {
    const errText = await uploadRes.text();
    await sendTelegram(env, chatId, `❌ Erro ao fazer upload: ${uploadRes.status}\n${errText.substring(0, 200)}`);
    return;
  }

  // 5. Update the event's image field in events.json if needed
  const { events, sha } = await getEventsFromGitHub(env);
  const idx = events.findIndex(e => e.id === event.id);
  if (idx !== -1 && events[idx].image !== imagePath) {
    events[idx].image = imagePath;
    await saveEventsToGitHub(env, events, sha, `Update image path for: ${event.title_pt}`);
  }

  const sizeKB = Math.round(imageBuffer.byteLength / 1024);
  await sendTelegram(env, chatId, `✅ *Foto atualizada!*\n\n📌 *${event.title_pt}*\n📁 ${imagePath}\n📦 ${sizeKB} KB\n\nA imagem aparecerá no site em alguns minutos.`);
}

// ── Confirmation Handlers ──

async function handleConfirm(env, chatId) {
  const pending = pendingActions.get(String(chatId));
  if (!pending) {
    await sendTelegram(env, chatId, '❌ Nenhuma ação pendente. Envie uma mensagem primeiro.');
    return;
  }

  pendingActions.delete(String(chatId));

  try {
    if (pending.action === 'create') {
      const { events, sha } = await getEventsFromGitHub(env);
      events.push(pending.event);
      await saveEventsToGitHub(env, events, sha, `Add event: ${pending.event.title_pt}`);
      await sendTelegram(env, chatId, `✅ *Evento criado com sucesso!*\n\n📌 *${pending.event.title_pt}*\n📅 ${pending.event.date}\n🕐 ${pending.event.time}\n🆔 ${pending.event.id}\n\nO evento aparecerá no site em alguns minutos.`);

    } else if (pending.action === 'edit') {
      const { events, sha } = await getEventsFromGitHub(env);
      const idx = events.findIndex(e => e.id === pending.event.id);
      if (idx === -1) {
        await sendTelegram(env, chatId, `❌ Evento "${pending.event.id}" não encontrado para editar.`);
        return;
      }
      // Merge: keep existing fields, override with new ones
      const existing = events[idx];
      events[idx] = { ...existing, ...pending.event };
      await saveEventsToGitHub(env, events, sha, `Update event: ${pending.event.title_pt}`);
      await sendTelegram(env, chatId, `✅ *Evento atualizado!*\n\n📌 *${pending.event.title_pt}*\n\nAs mudanças aparecerão no site em alguns minutos.`);

    } else if (pending.action === 'delete') {
      const { events, sha } = await getEventsFromGitHub(env);
      const idx = events.findIndex(e => e.id === pending.event_id);
      if (idx === -1) {
        await sendTelegram(env, chatId, `❌ Evento "${pending.event_id}" não encontrado.`);
        return;
      }
      const removed = events.splice(idx, 1)[0];
      await saveEventsToGitHub(env, events, sha, `Delete event: ${removed.title_pt}`);
      await sendTelegram(env, chatId, `🗑️ *Evento deletado:* ${removed.title_pt}\n\nA mudança aparecerá no site em alguns minutos.`);
    }
  } catch (err) {
    await sendTelegram(env, chatId, `❌ Erro: ${err.message}`);
  }
}

async function handleCancel(env, chatId) {
  const had = pendingActions.delete(String(chatId));
  if (had) {
    await sendTelegram(env, chatId, '❌ Ação cancelada.');
  } else {
    await sendTelegram(env, chatId, '❌ Nenhuma ação pendente para cancelar.');
  }
}

// ── Structured Command Handlers ──

async function handleHelp(env, chatId) {
  const helpText = `
🏠 *Family Church — Bot Admin*

*Linguagem natural:*
Apenas digite o que quer fazer! Ex:
"Cria um evento noite de oração dia 15 de março às 7pm"
O bot interpreta e pede confirmação.

*📸 Fotos:*
Envie uma foto com legenda mencionando o evento.
Ex: envie uma foto com legenda "cristina mel"
Sem legenda? O bot pergunta qual evento.

*Comandos estruturados:*

/newevent — Criar novo evento
\`\`\`
/newevent
Title PT: Dons Digitais
Title EN: Digital Gifts
Date: 2026-03-15
Time: 7:00 PM
Description PT: Descrição...
Description EN: Description...
\`\`\`

/editevent — Editar evento
\`\`\`
/editevent
ID: dons-digitais-2026
Date: 2026-04-01
\`\`\`

/deleteevent ID — Deletar evento
/listevents — Listar todos
/help — Esta mensagem

/sim — Confirmar ação pendente
/nao — Cancelar ação pendente
  `;
  await sendTelegram(env, chatId, helpText);
}

async function handleNewEvent(env, chatId, text) {
  try {
    const lines = text.split('\n').slice(1);
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
