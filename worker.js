/**
 * Mahila Jagriti Sansthan — Cloudflare Worker
 * Handles R2 storage (gallery photos, PDF reports) + static asset serving
 *
 * Environment bindings required (set in wrangler.jsonc):
 *   MJS_BUCKET  — R2 bucket
 *   ASSETS      — Static assets (index.html)
 *
 * Secret (set via: wrangler secret put ADMIN_TOKEN):
 *   ADMIN_TOKEN — must match UPASS in index.html (default: MJS@2024)
 */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // ── CORS preflight ──
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    try {
      // ── API routes ──
      if (path === '/api/list')   return handleList(request, env, url);
      if (path === '/api/file')   return handleFile(request, env, url);
      if (path === '/api/upload' && request.method === 'POST')   return handleUpload(request, env);
      if (path === '/api/delete' && request.method === 'DELETE') return handleDelete(request, env, url);

      // ── Static assets (index.html, etc.) ──
      return env.ASSETS.fetch(request);

    } catch (err) {
      return jsonResponse({ error: err.message }, 500);
    }
  }
};

// ─────────────────────────────────────────────────────────
// CORS
// ─────────────────────────────────────────────────────────
function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Token',
    'Access-Control-Max-Age': '86400',
  };
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
  });
}

// ─────────────────────────────────────────────────────────
// Auth
// ─────────────────────────────────────────────────────────
function isAdmin(request, env) {
  const token = request.headers.get('X-Admin-Token');
  // Falls back to hardcoded default if secret not set yet
  const expected = (env.ADMIN_TOKEN || 'MJS@2024');
  return token === expected;
}

// ─────────────────────────────────────────────────────────
// GET /api/list?type=gallery[&category=programs|trainings|awards]
// GET /api/list?type=reports&reptype=annual|financial
// ─────────────────────────────────────────────────────────
async function handleList(request, env, url) {
  const type     = url.searchParams.get('type');     // 'gallery' | 'reports'
  const category = url.searchParams.get('category'); // gallery sub-type
  const reptype  = url.searchParams.get('reptype');  // reports sub-type

  let prefix = '';
  if (type === 'gallery') {
    prefix = category ? `gallery/${category}/` : 'gallery/';
  } else if (type === 'reports') {
    prefix = reptype ? `reports/${reptype}/` : 'reports/';
  } else {
    return jsonResponse({ error: 'type must be gallery or reports' }, 400);
  }

  const listed = await env.MJS_BUCKET.list({ prefix, include: ['customMetadata', 'httpMetadata'] });

  const files = listed.objects.map(obj => ({
    key:      obj.key,
    url:      `/api/file?key=${encodeURIComponent(obj.key)}`,
    size:     obj.size,
    ts:       obj.uploaded ? String(obj.uploaded.getTime()) : String(Date.now()),
    ...(obj.customMetadata || {}),
  }));

  // Sort newest first
  files.sort((a, b) => parseInt(b.ts) - parseInt(a.ts));

  return jsonResponse(files);
}

// ─────────────────────────────────────────────────────────
// GET /api/file?key=gallery/programs/123_photo.jpg
// Serves the raw R2 file publicly (images served inline, PDFs as download)
// ─────────────────────────────────────────────────────────
async function handleFile(request, env, url) {
  const key = url.searchParams.get('key');
  if (!key) return jsonResponse({ error: 'Missing key parameter' }, 400);

  const obj = await env.MJS_BUCKET.get(key);
  if (!obj) return new Response('File not found', { status: 404, headers: corsHeaders() });

  const headers = new Headers(corsHeaders());
  obj.writeHttpMetadata(headers);
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  headers.set('ETag', obj.httpEtag);

  // Force download for PDFs
  if (key.toLowerCase().endsWith('.pdf')) {
    const filename = key.split('/').pop();
    headers.set('Content-Disposition', `attachment; filename="${filename}"`);
    headers.set('Content-Type', 'application/pdf');
  }

  return new Response(obj.body, { headers });
}

// ─────────────────────────────────────────────────────────
// POST /api/upload  (multipart/form-data, admin only)
// Fields: file, type (gallery|report), category, reptype, title
// ─────────────────────────────────────────────────────────
async function handleUpload(request, env) {
  if (!isAdmin(request, env)) {
    return jsonResponse({ error: 'Unauthorized — invalid admin token' }, 401);
  }

  let formData;
  try {
    formData = await request.formData();
  } catch {
    return jsonResponse({ error: 'Invalid multipart form data' }, 400);
  }

  const file    = formData.get('file');
  const type    = formData.get('type');     // 'gallery' | 'report'
  const category= formData.get('category');
  const reptype = formData.get('reptype');
  const title   = formData.get('title');

  if (!file || typeof file === 'string') {
    return jsonResponse({ error: 'No file provided' }, 400);
  }

  const ts = Date.now();
  // Sanitise filename — allow only safe characters
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100);

  let key, metadata;

  if (type === 'gallery') {
    if (!['programs', 'trainings', 'awards'].includes(category)) {
      return jsonResponse({ error: 'category must be programs, trainings, or awards' }, 400);
    }
    key      = `gallery/${category}/${ts}_${safeName}`;
    metadata = { type: 'gallery', category, ts: String(ts) };

  } else if (type === 'report') {
    if (!['annual', 'financial'].includes(reptype)) {
      return jsonResponse({ error: 'reptype must be annual or financial' }, 400);
    }
    const safeTitle = (title || safeName.replace(/\.pdf$/i, '')).slice(0, 120);
    key      = `reports/${reptype}/${ts}_${safeName}`;
    metadata = { type: 'report', reptype, title: safeTitle, ts: String(ts) };

  } else {
    return jsonResponse({ error: 'type must be gallery or report' }, 400);
  }

  const buffer = await file.arrayBuffer();
  await env.MJS_BUCKET.put(key, buffer, {
    httpMetadata:   { contentType: file.type || 'application/octet-stream' },
    customMetadata: metadata,
  });

  return jsonResponse({
    success: true,
    key,
    url: `/api/file?key=${encodeURIComponent(key)}`,
  });
}

// ─────────────────────────────────────────────────────────
// DELETE /api/delete?key=gallery/programs/123_photo.jpg  (admin only)
// ─────────────────────────────────────────────────────────
async function handleDelete(request, env, url) {
  if (!isAdmin(request, env)) {
    return jsonResponse({ error: 'Unauthorized — invalid admin token' }, 401);
  }

  const key = url.searchParams.get('key');
  if (!key) return jsonResponse({ error: 'Missing key parameter' }, 400);

  await env.MJS_BUCKET.delete(key);
  return jsonResponse({ success: true, deleted: key });
}
