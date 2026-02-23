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
 *   /addphoto    — Add a gallery photo to an event
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
 *   AI              — Workers AI binding (for natural language parsing)
 *   PENDING_ACTIONS — KV namespace for persistent state between messages
 */

const EVENTS_PATH = 'data/events.json';
const BRANCH = 'main';
const PENDING_TTL = 300; // 5 minutes — pending actions expire after this

// ── Persistent state helpers (Cloudflare KV) ──

async function getPending(env, chatId) {
  const data = await env.PENDING_ACTIONS.get(`pending:${chatId}`, 'json');
  return data;
}

async function setPending(env, chatId, value) {
  await env.PENDING_ACTIONS.put(`pending:${chatId}`, JSON.stringify(value), { expirationTtl: PENDING_TTL });
}

async function deletePending(env, chatId) {
  await env.PENDING_ACTIONS.delete(`pending:${chatId}`);
}

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
      } else if (text.startsWith('/addphoto')) {
        await handleAddPhotoCommand(env, chatId, text);
      } else if (text.startsWith('/help') || text.startsWith('/start')) {
        await handleHelp(env, chatId);
      } else if (text === '/sim' || text === '/yes') {
        await handleConfirm(env, chatId);
      } else if (text === '/nao' || text === '/no' || text === '/cancelar') {
        await handleCancel(env, chatId);
      } else if (!text.startsWith('/')) {
        // Check if there's a pending action waiting for user input
        const pending = await getPending(env, chatId);
        if (pending && pending.action === 'photo_waiting') {
          await handlePhotoEventId(env, chatId, text, pending.fileId);
        } else if (pending && pending.action === 'gallery_waiting') {
          await handleGalleryEventId(env, chatId, text, pending.fileId);
        } else if (pending && pending.action === 'addphoto_waiting') {
          // /addphoto was used, now waiting for event ID text, photo will come next
          await handleAddPhotoEventSelected(env, chatId, text);
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

// ── Encoding helpers ──

function base64ToUtf8(base64) {
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
  return new TextDecoder('utf-8').decode(bytes);
}

function utf8ToBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
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
  const content = base64ToUtf8(data.content.replace(/\n/g, ''));
  return { events: JSON.parse(content), sha: data.sha };
}

async function saveEventsToGitHub(env, events, sha, commitMessage) {
  const content = utf8ToBase64(JSON.stringify(events, null, 2) + '\n');
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

function buildAIPrompt(events) {
  const eventList = events.length > 0
    ? '\n\nExisting events:\n' + events.map(e => `- ID: "${e.id}" | Title: "${e.title_pt}" | Date: ${e.date} | Time: ${e.time}`).join('\n')
    : '\n\nNo events exist yet.';

  return `You are a helpful assistant for Family Church (a Brazilian church in Stamford, CT).
Parse the admin's natural language message into a structured JSON action.

Current year: 2026. Church address: 18 Cushing Street, Stamford, CT.
${eventList}

Return ONLY valid JSON (no markdown, no code blocks, no explanation):

For CREATE:
{"action":"create","title_pt":"...","title_en":"...","description_pt":"...","description_en":"...","date":"YYYY-MM-DD","time":"HH:MM AM/PM","status":"upcoming"}

For EDIT (only include fields being changed + event_id):
{"action":"edit","event_id":"existing-event-id","date":"YYYY-MM-DD","time":"HH:MM AM/PM"}

For DELETE:
{"action":"delete","event_id":"existing-event-id"}

For LIST:
{"action":"list"}

If you can't understand:
{"action":"unknown"}

Rules:
- For EDIT: event_id MUST be one of the existing event IDs listed above. Only include the fields the user wants to change.
- For DELETE: event_id MUST be an existing ID. Match by name if the user doesn't say the exact ID.
- Translate between PT and EN when needed (title, description)
- Dates: natural language to YYYY-MM-DD. Times: 12-hour with AM/PM.
- If date/time not mentioned, omit them (don't use TBD for edits)
- For create: write 2-3 inviting sentences for the description`;
}

// Fuzzy match: search user's text and AI's event_id/title against all events
function findEventFuzzy(events, parsed, userText) {
  // 1. Exact ID match from AI
  if (parsed.event_id) {
    const exact = events.find(e => e.id === parsed.event_id);
    if (exact) return exact;
  }

  // 2. Partial ID match from AI
  if (parsed.event_id) {
    const partial = events.find(e => e.id.includes(parsed.event_id) || parsed.event_id.includes(e.id));
    if (partial) return partial;
  }

  // 3. Title match from AI response
  if (parsed.title_pt || parsed.title_en) {
    const match = events.find(e =>
      (parsed.title_pt && e.title_pt.toLowerCase().includes(parsed.title_pt.toLowerCase())) ||
      (parsed.title_en && e.title_en.toLowerCase().includes(parsed.title_en.toLowerCase()))
    );
    if (match) return match;
  }

  // 4. Search the user's original text for any event title or ID
  const textLower = userText.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  for (const e of events) {
    const titleNorm = e.title_pt.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    // Check if any significant word (3+ chars) from the event title appears in the user text
    const words = titleNorm.split(/\s+/).filter(w => w.length >= 3);
    const matchCount = words.filter(w => textLower.includes(w)).length;
    if (matchCount >= 2 || (words.length <= 2 && matchCount >= 1)) return e;
  }

  // 5. Check if user text contains event ID fragments
  for (const e of events) {
    const idParts = e.id.split('-').filter(p => p.length >= 3);
    const matchCount = idParts.filter(p => textLower.includes(p)).length;
    if (matchCount >= 2) return e;
  }

  return null;
}

async function handleNaturalLanguage(env, chatId, text) {
  try {
    // Fetch existing events so AI knows what can be edited/deleted
    const { events } = await getEventsFromGitHub(env);
    const systemPrompt = buildAIPrompt(events);

    const response = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: text }
      ],
      max_tokens: 512,
      temperature: 0.3
    });

    const aiText = response.response || '';

    // Try to extract JSON from the response
    let parsed;
    try {
      const jsonMatch = aiText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON found');
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      await sendTelegram(env, chatId, '🤔 Não entendi. Tente de novo com mais detalhes, ou use /help.');
      return;
    }

    if (parsed.action === 'unknown') {
      await sendTelegram(env, chatId, '🤔 Não entendi. Tente algo como:\n"Cria um evento noite de oração dia 15 de março às 7pm"\n"Muda a data da Cristina Mel pra 20 de março"');
      return;
    }

    if (parsed.action === 'list') {
      await handleListEvents(env, chatId);
      return;
    }

    // ── DELETE ──
    if (parsed.action === 'delete') {
      const target = findEventFuzzy(events, parsed, text);
      if (target) {
        await setPending(env, chatId, { action: 'delete', event_id: target.id });
        await sendTelegram(env, chatId, `🗑️ Deletar *${target.title_pt}*?\n\n✅ /sim para confirmar\n❌ /nao para cancelar`);
      } else {
        await sendTelegram(env, chatId, '❌ Não encontrei esse evento. Use /listevents para ver os eventos.');
      }
      return;
    }

    // ── EDIT ──
    if (parsed.action === 'edit') {
      const existing = findEventFuzzy(events, parsed, text);

      if (!existing) {
        await sendTelegram(env, chatId, '❌ Não encontrei esse evento. Use /listevents para ver os eventos.');
        return;
      }

      parsed.event_id = existing.id;

      // Build changes object — only fields the AI returned (excluding action and event_id)
      const changes = {};
      if (parsed.title_pt) changes.title_pt = parsed.title_pt;
      if (parsed.title_en) changes.title_en = parsed.title_en;
      if (parsed.description_pt) changes.description_pt = parsed.description_pt;
      if (parsed.description_en) changes.description_en = parsed.description_en;
      if (parsed.date) changes.date = parsed.date;
      if (parsed.time) changes.time = parsed.time;
      if (parsed.status) changes.status = parsed.status;

      await setPending(env, chatId, {
        action: 'edit',
        event_id: parsed.event_id,
        changes: changes
      });

      // Build a friendly preview of what's changing
      const changeLines = [];
      if (changes.title_pt) changeLines.push(`📌 Título: ${changes.title_pt}`);
      if (changes.date) changeLines.push(`📅 Data: ${changes.date}`);
      if (changes.time) changeLines.push(`🕐 Horário: ${changes.time}`);
      if (changes.description_pt) changeLines.push(`📝 Descrição: ${changes.description_pt.substring(0, 100)}...`);
      if (changes.status) changeLines.push(`📊 Status: ${changes.status}`);

      const preview = `✏️ Editar *${existing.title_pt}*:\n\n${changeLines.join('\n')}\n\n✅ /sim para confirmar\n❌ /nao para cancelar`;
      await sendTelegram(env, chatId, preview);
      return;
    }

    // ── CREATE ──
    const titlePt = parsed.title_pt || 'Sem título';
    const titleEn = parsed.title_en || titlePt;
    const date = parsed.date || 'TBD';
    const time = parsed.time || 'TBD';
    const descPt = parsed.description_pt || '';
    const descEn = parsed.description_en || descPt;

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
      status: parsed.status || 'upcoming'
    };

    await setPending(env, chatId, {
      action: 'create',
      event: eventData
    });

    const preview = `➕ Criar evento:\n\n📌 *${titlePt}*\n🇺🇸 ${titleEn}\n📅 ${date}\n🕐 ${time}\n📝 ${descPt.substring(0, 120)}${descPt.length > 120 ? '...' : ''}\n\n✅ /sim para confirmar\n❌ /nao para cancelar`;
    await sendTelegram(env, chatId, preview);

  } catch (err) {
    console.error('AI parsing error:', err);
    await sendTelegram(env, chatId, `❌ Erro ao processar: ${err.message}\n\nTente usar /help para ver os comandos estruturados.`);
  }
}

// ── Photo Upload Handler ──

// Gallery keyword detection
const GALLERY_KEYWORDS = ['galeria', 'fotos', 'gallery', 'foto do evento', 'photos'];

function isGalleryCaption(caption) {
  const lower = caption.toLowerCase();
  return GALLERY_KEYWORDS.some(kw => lower.includes(kw));
}

function stripGalleryKeywords(caption) {
  let cleaned = caption;
  for (const kw of GALLERY_KEYWORDS) {
    cleaned = cleaned.replace(new RegExp(kw, 'gi'), '');
  }
  return cleaned.trim();
}

async function handlePhotoUpload(env, chatId, message) {
  try {
    const caption = (message.caption || '').trim();

    // Get highest resolution photo (last in the array)
    const photo = message.photo[message.photo.length - 1];
    const fileId = photo.file_id;

    // Check if there's a pending /addphoto waiting for a photo
    const pending = await getPending(env, chatId);
    if (pending && pending.action === 'addphoto_ready') {
      // Already selected event via /addphoto, upload as gallery
      await deletePending(env, chatId);
      const { events } = await getEventsFromGitHub(env);
      const targetEvent = events.find(e => e.id === pending.eventId);
      if (!targetEvent) {
        await sendTelegram(env, chatId, `❌ Evento "${pending.eventId}" nao encontrado.`);
        return;
      }
      await uploadGalleryPhotoToGitHub(env, chatId, fileId, targetEvent);
      return;
    }

    // Detect gallery mode from caption keywords
    const isGallery = caption && isGalleryCaption(caption);

    // If no caption, ask which event the photo is for (default: cover)
    if (!caption) {
      await setPending(env, chatId, { action: 'photo_waiting', fileId });
      const { events } = await getEventsFromGitHub(env);
      if (events.length === 0) {
        await sendTelegram(env, chatId, '❌ Nenhum evento encontrado. Crie um evento primeiro com /newevent.');
        await deletePending(env, chatId);
        return;
      }
      const list = events.map(e => `🆔 \`${e.id}\`\n   📌 ${e.title_pt}`).join('\n\n');
      await sendTelegram(env, chatId, `📸 Foto recebida!\n\nPara qual evento e essa foto? (capa do evento)\nPara galeria, envie a foto com legenda "galeria [nome do evento]"\n\n${list}\n\nOu digite o ID do evento:`);
      return;
    }

    // Caption provided — find the target event
    const searchText = isGallery ? stripGalleryKeywords(caption) : caption;
    const { events } = await getEventsFromGitHub(env);
    let targetEvent = findEventFromCaption(events, searchText, env);

    // If still no match, try AI
    if (!targetEvent && events.length > 0) {
      targetEvent = await matchEventWithAI(env, events, searchText);
    }

    // If still no match, try fuzzy search on the full caption
    if (!targetEvent) {
      targetEvent = findEventFuzzy(events, {}, searchText);
    }

    if (!targetEvent) {
      // Store photo and ask
      const pendingAction = isGallery ? 'gallery_waiting' : 'photo_waiting';
      await setPending(env, chatId, { action: pendingAction, fileId });
      const list = events.map(e => `🆔 \`${e.id}\`\n   📌 ${e.title_pt}`).join('\n\n');
      await sendTelegram(env, chatId, `📸 Foto recebida, mas nao consegui identificar o evento.\n\nEnvie o ID do evento:\n\n${list}`);
      return;
    }

    // Upload the photo
    if (isGallery) {
      await uploadGalleryPhotoToGitHub(env, chatId, fileId, targetEvent);
    } else {
      await uploadPhotoToGitHub(env, chatId, fileId, targetEvent);
    }

  } catch (err) {
    console.error('Photo upload error:', err);
    await sendTelegram(env, chatId, `❌ Erro ao processar foto: ${err.message}`);
  }
}

// Helper: find event from caption text (no AI)
function findEventFromCaption(events, caption, env) {
  const captionLower = caption.toLowerCase().trim();
  if (!captionLower) return null;

  // Exact ID match
  let target = events.find(e => captionLower.includes(e.id));
  if (target) return target;

  // Title match
  target = events.find(e =>
    captionLower.includes(e.title_pt.toLowerCase()) ||
    captionLower.includes(e.title_en.toLowerCase())
  );
  if (target) return target;

  return null;
}

// Helper: use AI to match caption to event
async function matchEventWithAI(env, events, caption) {
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
    return events.find(e => e.id === matchedId) || null;
  } catch {
    return null;
  }
}

async function handlePhotoEventId(env, chatId, text, fileId) {
  await deletePending(env, chatId);
  const { events } = await getEventsFromGitHub(env);
  const targetEvent = findEventFromText(events, text);

  if (!targetEvent) {
    await sendTelegram(env, chatId, `❌ Evento "${text}" nao encontrado.\n\nUse /listevents para ver os IDs e envie a foto novamente.`);
    return;
  }

  await uploadPhotoToGitHub(env, chatId, fileId, targetEvent);
}

async function handleGalleryEventId(env, chatId, text, fileId) {
  await deletePending(env, chatId);
  const { events } = await getEventsFromGitHub(env);
  const targetEvent = findEventFromText(events, text);

  if (!targetEvent) {
    await sendTelegram(env, chatId, `❌ Evento "${text}" nao encontrado.\n\nUse /listevents para ver os IDs e envie a foto novamente.`);
    return;
  }

  await uploadGalleryPhotoToGitHub(env, chatId, fileId, targetEvent);
}

// Helper: find event from free-text user input
function findEventFromText(events, text) {
  const input = text.trim().toLowerCase();
  let target = events.find(e => e.id === input);
  if (target) return target;

  target = events.find(e =>
    e.id.includes(input) ||
    e.title_pt.toLowerCase().includes(input) ||
    e.title_en.toLowerCase().includes(input)
  );
  if (target) return target;

  // Use fuzzy search as last resort
  return findEventFuzzy(events, {}, text);
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
  const base64Image = arrayBufferToBase64(imageBuffer);

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
  await sendTelegram(env, chatId, `✅ *Foto de capa atualizada!*\n\n📌 *${event.title_pt}*\n📁 ${imagePath}\n📦 ${sizeKB} KB\n\nA imagem aparecera no site em alguns minutos.`);
}

// ── Gallery Photo Upload ──

async function uploadGalleryPhotoToGitHub(env, chatId, fileId, event) {
  await sendTelegram(env, chatId, `⏳ Adicionando foto a galeria de *${event.title_pt}*...`);

  // 1. Get file path from Telegram
  const fileRes = await fetch(
    `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getFile?file_id=${fileId}`
  );
  const fileData = await fileRes.json();
  if (!fileData.ok || !fileData.result.file_path) {
    await sendTelegram(env, chatId, '❌ Nao consegui obter o arquivo do Telegram.');
    return;
  }

  // 2. Download the photo from Telegram
  const downloadUrl = `https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${fileData.result.file_path}`;
  const imageRes = await fetch(downloadUrl);
  if (!imageRes.ok) {
    await sendTelegram(env, chatId, '❌ Nao consegui baixar a foto do Telegram.');
    return;
  }
  const imageBuffer = await imageRes.arrayBuffer();
  const base64Image = arrayBufferToBase64(imageBuffer);

  // 3. Determine photo number from existing gallery
  const currentPhotos = event.photos || [];
  const photoNum = currentPhotos.length + 1;
  const imagePath = `images/events/${event.id}/photo-${photoNum}.jpg`;

  // 4. Upload to GitHub
  const uploadBody = {
    message: `Add gallery photo ${photoNum} for: ${event.title_pt}`,
    content: base64Image,
    branch: BRANCH
  };

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

  // 5. Update event's photos array in events.json
  const { events, sha } = await getEventsFromGitHub(env);
  const idx = events.findIndex(e => e.id === event.id);
  if (idx !== -1) {
    if (!events[idx].photos) events[idx].photos = [];
    events[idx].photos.push(imagePath);
    await saveEventsToGitHub(env, events, sha, `Add gallery photo ${photoNum} for: ${event.title_pt}`);
  }

  const sizeKB = Math.round(imageBuffer.byteLength / 1024);
  const totalPhotos = (event.photos || []).length + 1;
  await sendTelegram(env, chatId, `✅ *Foto ${photoNum} adicionada a galeria!*\n\n📌 *${event.title_pt}*\n📁 ${imagePath}\n📦 ${sizeKB} KB\n🖼️ ${totalPhotos} foto(s) na galeria\n\nAs fotos aparecerao no site em alguns minutos.`);
}

// ── /addphoto Command Handler ──

async function handleAddPhotoCommand(env, chatId, text) {
  const lines = text.split('\n').slice(1);
  const fields = parseFields(lines);
  const id = fields['id'];

  if (id) {
    // ID provided inline: /addphoto\nID: event-id
    const { events } = await getEventsFromGitHub(env);
    const target = events.find(e => e.id === id) || findEventFuzzy(events, { event_id: id }, id);
    if (!target) {
      await sendTelegram(env, chatId, `❌ Evento "${id}" nao encontrado.\n\nUse /listevents para ver os IDs.`);
      return;
    }
    await setPending(env, chatId, { action: 'addphoto_ready', eventId: target.id });
    await sendTelegram(env, chatId, `📸 Pronto! Agora envie a foto para adicionar a galeria de *${target.title_pt}*.\n\nVoce pode enviar varias fotos, uma de cada vez.`);
  } else {
    // No ID — show event list
    const { events } = await getEventsFromGitHub(env);
    if (events.length === 0) {
      await sendTelegram(env, chatId, '❌ Nenhum evento encontrado. Crie um evento primeiro.');
      return;
    }
    const list = events.map(e => {
      const photoCount = (e.photos || []).length;
      return `🆔 \`${e.id}\`\n   📌 ${e.title_pt} (${photoCount} foto${photoCount !== 1 ? 's' : ''})`;
    }).join('\n\n');
    await setPending(env, chatId, { action: 'addphoto_waiting' });
    await sendTelegram(env, chatId, `📸 *Adicionar foto a galeria*\n\nDigite o ID do evento:\n\n${list}`);
  }
}

async function handleAddPhotoEventSelected(env, chatId, text) {
  await deletePending(env, chatId);
  const { events } = await getEventsFromGitHub(env);
  const target = findEventFromText(events, text);

  if (!target) {
    await sendTelegram(env, chatId, `❌ Evento "${text}" nao encontrado.\n\nUse /listevents para ver os IDs.`);
    return;
  }

  await setPending(env, chatId, { action: 'addphoto_ready', eventId: target.id });
  await sendTelegram(env, chatId, `📸 Pronto! Agora envie a foto para adicionar a galeria de *${target.title_pt}*.\n\nVoce pode enviar varias fotos, uma de cada vez.`);
}

// ── Confirmation Handlers ──

async function handleConfirm(env, chatId) {
  const pending = await getPending(env, chatId);
  if (!pending) {
    await sendTelegram(env, chatId, '❌ Nenhuma ação pendente. Envie uma mensagem primeiro.');
    return;
  }

  await deletePending(env, chatId);

  try {
    if (pending.action === 'create') {
      const { events, sha } = await getEventsFromGitHub(env);
      events.push(pending.event);
      await saveEventsToGitHub(env, events, sha, `Add event: ${pending.event.title_pt}`);
      await sendTelegram(env, chatId, `✅ *Evento criado com sucesso!*\n\n📌 *${pending.event.title_pt}*\n📅 ${pending.event.date}\n🕐 ${pending.event.time}\n🆔 ${pending.event.id}\n\nO evento aparecerá no site em alguns minutos.`);

    } else if (pending.action === 'edit') {
      const { events, sha } = await getEventsFromGitHub(env);
      // Support both formats: event_id+changes (AI) or event.id (old format)
      const editId = pending.event_id || (pending.event && pending.event.id);
      const idx = events.findIndex(e => e.id === editId);
      if (idx === -1) {
        await sendTelegram(env, chatId, `❌ Evento "${editId}" não encontrado para editar.`);
        return;
      }
      // Patch only the changed fields
      const changes = pending.changes || pending.event || {};
      const existing = events[idx];
      for (const [key, value] of Object.entries(changes)) {
        if (key !== 'event_id' && key !== 'action' && value) {
          existing[key] = value;
        }
      }
      events[idx] = existing;
      await saveEventsToGitHub(env, events, sha, `Update event: ${existing.title_pt}`);
      await sendTelegram(env, chatId, `✅ *${existing.title_pt}* atualizado!\n\nAs mudanças aparecerão no site em alguns minutos.`);

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
  const existing = await getPending(env, chatId);
  if (existing) {
    await deletePending(env, chatId);
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
"Cria um evento noite de oração dia 15 de março as 7pm"
O bot interpreta e pede confirmacao.

*📸 Foto de capa:*
Envie uma foto com legenda mencionando o evento.
Ex: foto com legenda "cristina mel"

*🖼️ Galeria de fotos:*
Envie foto com legenda "galeria [nome do evento]"
Ex: "galeria cristina mel" ou "fotos dons digitais"
Ou use /addphoto para selecionar o evento primeiro.

*Comandos:*

/newevent — Criar novo evento
/editevent — Editar evento
/deleteevent ID — Deletar evento
/listevents — Listar todos
/addphoto — Adicionar foto a galeria
/help — Esta mensagem
/sim — Confirmar acao pendente
/nao — Cancelar acao pendente
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
