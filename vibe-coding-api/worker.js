/**
 * Family Church — Vibe Coding API
 * Cloudflare Worker — Proxies Claude API for the workshop
 *
 * Endpoints:
 *   POST   /chat        — Public (rate-limited). Send messages to Claude.
 *   GET    /apps        — Public. Get all saved participant apps.
 *   GET    /app/:name   — Public. Get a specific participant's latest app.
 *   GET    /health      — Public. Health check.
 *   OPTIONS *           — CORS preflight.
 *
 * Environment bindings:
 *   VIBE_SESSIONS   — KV namespace (rate limits + saved apps)
 *   ANTHROPIC_API_KEY — Secret API key for Claude
 */

const ALLOWED_ORIGINS = [
  'https://familychurchct.net',
  'https://www.familychurchct.net',
  'https://familychurch995-tech.github.io',
  'http://localhost:3000',
  'http://localhost:5500',
  'http://127.0.0.1:5500',
  'http://127.0.0.1:3000',
];

const CLAUDE_MODEL = 'claude-sonnet-4-20250514';
const MAX_TOKENS = 8000;
const MAX_REQUESTS_PER_PARTICIPANT = 60;
const RATE_LIMIT_TTL = 10800; // 3 hours

const SYSTEM_PROMPT = `You are a helpful coding assistant for a church workshop called "Dons Digitais" (Digital Gifts). Your job is to help beginners create web apps by describing what they want in plain language.

RULES:
1. ALWAYS respond in the same language the user writes in (Portuguese or English).
2. ALWAYS generate a COMPLETE, self-contained HTML file with inline CSS and JavaScript. Never use external dependencies or CDN links unless the user specifically asks.
3. Make apps beautiful by default: use dark themes, gradients, smooth animations, good typography, vibrant colors.
4. Make everything mobile-friendly (include viewport meta tag, use responsive CSS).
5. When the user asks to modify an existing app, return the FULL updated HTML file, not just the changed parts.
6. Wrap your HTML code in a single \`\`\`html code block.
7. Before the code block, write a BRIEF explanation (2-3 sentences max) of what you built or changed. Be encouraging!
8. Keep the code clean and well-organized but don't add excessive comments.
9. If the user's request is vague, make creative decisions and build something impressive.
10. The apps should work standalone — a single HTML file that can be opened in any browser.`;

function corsHeaders(origin) {
  const effectiveOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': effectiveOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

function jsonResponse(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders(origin),
    },
  });
}

function extractHtml(text) {
  const match = text.match(/```html\s*([\s\S]*?)```/);
  return match ? match[1].trim() : null;
}

async function checkRateLimit(env, name) {
  const key = `rate:${name.toLowerCase().trim()}`;
  const current = await env.VIBE_SESSIONS.get(key, 'json');
  const count = current ? current.count : 0;
  if (count >= MAX_REQUESTS_PER_PARTICIPANT) {
    return { allowed: false, count };
  }
  await env.VIBE_SESSIONS.put(key, JSON.stringify({ count: count + 1 }), {
    expirationTtl: RATE_LIMIT_TTL,
  });
  return { allowed: true, count: count + 1 };
}

async function saveParticipantApp(env, name, html) {
  const key = `app:${name.toLowerCase().trim()}`;
  await env.VIBE_SESSIONS.put(key, JSON.stringify({
    name: name.trim(),
    html,
    updatedAt: new Date().toISOString(),
  }), { expirationTtl: 86400 }); // 24 hours
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    const origin = request.headers.get('Origin') || '';

    // CORS preflight
    if (method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    try {
      // ── GET /health ──
      if (method === 'GET' && path === '/health') {
        return jsonResponse({ status: 'ok', model: CLAUDE_MODEL }, 200, origin);
      }

      // ── GET /apps — list all participant apps ──
      if (method === 'GET' && path === '/apps') {
        const apps = [];
        const list = await env.VIBE_SESSIONS.list({ prefix: 'app:' });
        for (const key of list.keys) {
          const data = await env.VIBE_SESSIONS.get(key.name, 'json');
          if (data) {
            apps.push({ name: data.name, updatedAt: data.updatedAt });
          }
        }
        return jsonResponse({ apps }, 200, origin);
      }

      // ── GET /app/:name — get a specific participant's app ──
      const appMatch = path.match(/^\/app\/(.+)$/);
      if (method === 'GET' && appMatch) {
        const name = decodeURIComponent(appMatch[1]);
        const key = `app:${name.toLowerCase().trim()}`;
        const data = await env.VIBE_SESSIONS.get(key, 'json');
        if (!data) {
          return jsonResponse({ error: 'App not found' }, 404, origin);
        }
        return jsonResponse(data, 200, origin);
      }

      // ── POST /chat ──
      if (method === 'POST' && path === '/chat') {
        const body = await request.json();
        const { messages, participantName } = body;

        if (!messages || !Array.isArray(messages) || messages.length === 0) {
          return jsonResponse({ error: 'Messages array is required' }, 400, origin);
        }
        if (!participantName || typeof participantName !== 'string') {
          return jsonResponse({ error: 'Participant name is required' }, 400, origin);
        }

        // Rate limit
        const rateCheck = await checkRateLimit(env, participantName);
        if (!rateCheck.allowed) {
          return jsonResponse({
            error: 'Limite de mensagens atingido. Peça ajuda ao instrutor! / Message limit reached. Ask the instructor for help!',
            code: 'RATE_LIMITED',
          }, 429, origin);
        }

        // Call Claude API
        const claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': env.ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: CLAUDE_MODEL,
            max_tokens: MAX_TOKENS,
            system: SYSTEM_PROMPT,
            messages: messages.map(m => ({
              role: m.role,
              content: m.content,
            })),
          }),
        });

        if (!claudeResponse.ok) {
          const errText = await claudeResponse.text();
          console.error('Claude API error:', claudeResponse.status, errText);
          return jsonResponse({
            error: 'Erro ao conectar com a IA. Tente novamente! / Error connecting to AI. Try again!',
            code: 'CLAUDE_ERROR',
          }, 502, origin);
        }

        const claudeData = await claudeResponse.json();
        const content = claudeData.content?.[0]?.text || '';
        const html = extractHtml(content);

        // Save app to KV if HTML was generated
        if (html) {
          ctx.waitUntil(saveParticipantApp(env, participantName, html));
        }

        return jsonResponse({
          content,
          html,
          usage: {
            remaining: MAX_REQUESTS_PER_PARTICIPANT - rateCheck.count,
          },
        }, 200, origin);
      }

      return jsonResponse({ error: 'Not found' }, 404, origin);

    } catch (err) {
      console.error('Worker error:', err);
      return jsonResponse({ error: 'Internal server error' }, 500, origin);
    }
  },
};
