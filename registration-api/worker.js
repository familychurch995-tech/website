/**
 * Family Church — Event Registration API
 * Cloudflare Worker + KV
 *
 * Endpoints:
 *   POST   /register       — Public. Save a new registration.
 *   GET    /count           — Public. Return registration count.
 *   GET    /registrations   — Protected. Return all registrations.
 *   DELETE /registrations   — Protected. Clear all registrations.
 *   OPTIONS *               — CORS preflight.
 *
 * Environment bindings:
 *   REGISTRATIONS  — KV namespace
 *   ADMIN_TOKEN    — Secret for admin endpoints
 */

const ALLOWED_ORIGINS = [
  'https://familychurchct.net',
  'https://www.familychurchct.net',
  'http://localhost:3000',
  'http://localhost:5500',
  'http://127.0.0.1:5500',
  'http://127.0.0.1:3000',
];

const KV_KEY = 'registrations';

function corsHeaders(origin) {
  const effectiveOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': effectiveOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
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

function isAuthorized(request, env) {
  const auth = request.headers.get('Authorization');
  return auth === `Bearer ${env.ADMIN_TOKEN}`;
}

async function getRegistrations(env) {
  const data = await env.REGISTRATIONS.get(KV_KEY, 'json');
  return data || [];
}

async function saveRegistrations(env, registrations) {
  await env.REGISTRATIONS.put(KV_KEY, JSON.stringify(registrations));
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    const origin = request.headers.get('Origin') || '';

    // CORS preflight
    if (method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    try {
      // ── POST /register (public) ──
      if (method === 'POST' && path === '/register') {
        const body = await request.json();
        const { name, email, phone, notifications, laptop } = body;

        if (!name || !email || !phone) {
          return jsonResponse({ error: 'Missing required fields' }, 400, origin);
        }
        if (!email.includes('@')) {
          return jsonResponse({ error: 'Invalid email' }, 400, origin);
        }

        const registration = {
          id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
          name: name.trim(),
          email: email.trim().toLowerCase(),
          phone: phone.trim(),
          notifications: !!notifications,
          laptop: !!laptop,
          timestamp: new Date().toISOString(),
        };

        const registrations = await getRegistrations(env);

        // Duplicate check
        if (registrations.find(r => r.email === registration.email)) {
          return jsonResponse({
            error: 'Este email já está registrado / This email is already registered',
            count: registrations.length,
          }, 409, origin);
        }

        registrations.push(registration);
        await saveRegistrations(env, registrations);

        return jsonResponse({ success: true, count: registrations.length }, 201, origin);
      }

      // ── GET /count (public) ──
      if (method === 'GET' && path === '/count') {
        const registrations = await getRegistrations(env);
        return jsonResponse({ count: registrations.length }, 200, origin);
      }

      // ── GET /registrations (admin) ──
      if (method === 'GET' && path === '/registrations') {
        if (!isAuthorized(request, env)) {
          return jsonResponse({ error: 'Unauthorized' }, 401, origin);
        }
        const registrations = await getRegistrations(env);
        return jsonResponse({ registrations, count: registrations.length }, 200, origin);
      }

      // ── DELETE /registrations (admin) ──
      if (method === 'DELETE' && path === '/registrations') {
        if (!isAuthorized(request, env)) {
          return jsonResponse({ error: 'Unauthorized' }, 401, origin);
        }
        await saveRegistrations(env, []);
        return jsonResponse({ success: true, count: 0 }, 200, origin);
      }

      return jsonResponse({ error: 'Not found' }, 404, origin);

    } catch (err) {
      console.error('Worker error:', err);
      return jsonResponse({ error: 'Internal server error' }, 500, origin);
    }
  },
};
