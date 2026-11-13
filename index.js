/**
 * Host half of the drag-to-project bundle.
 *
 * A browser drop never reveals an absolute path, so the Client sends the
 * dropped folder's name, its top-level entry names, and the parents of
 * registered Workspaces. This plugin answers with ranked host candidates (or
 * validates one explicit path); the Client then registers the Workspace
 * through the existing Workspace Remote, so no second registry is introduced.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { resolveCandidates } from './search.js';

/** The browser HTTP carrier; without it this plugin stays inactive. */
export const inject = ['webServer'];

/** Endpoint the Client posts one drop to. */
const ROUTE = '/dsh-drop-workspace/resolve';
/** Largest accepted request body; a drop payload is a few kilobytes. */
const MAX_BODY_BYTES = 64 * 1024;

/**
 * Register the resolution route.
 * @param ctx - Host root context carrying `webServer`.
 */
export function apply(ctx) {
  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'exact',
      path: ROUTE,
      handler: (req, res) => {
        void handle(ctx, req, res);
      },
    }),
  );
}

/**
 * Answer one resolution request.
 * @param ctx - Host root context.
 * @param req - Node request.
 * @param res - Node response.
 */
async function handle(ctx, req, res) {
  if (req.method !== 'POST') {
    send(res, 405, { ok: false, error: 'method-not-allowed' });
    return;
  }
  if (!sameOrigin(ctx, req)) {
    send(res, 403, { ok: false, error: 'cross-origin' });
    return;
  }
  let body;
  try {
    body = await readJsonBody(req);
  } catch (error) {
    send(res, 400, { ok: false, error: error instanceof Error ? error.message : 'bad-request' });
    return;
  }
  const explicitPath = typeof body.path === 'string' ? body.path.trim() : '';
  if (explicitPath !== '') {
    if (!path.isAbsolute(explicitPath)) {
      send(res, 400, { ok: false, error: 'not-absolute' });
      return;
    }
    const resolved = path.resolve(explicitPath);
    try {
      const stat = await fs.stat(resolved);
      if (!stat.isDirectory()) {
        send(res, 400, { ok: false, error: 'not-a-directory' });
        return;
      }
    } catch {
      send(res, 404, { ok: false, error: 'not-a-directory' });
      return;
    }
    send(res, 200, {
      ok: true,
      candidates: [{ path: resolved, title: path.basename(resolved), matched: 0, total: 0, score: 1 }],
      scanned: 1,
      truncated: false,
    });
    return;
  }
  try {
    const result = await resolveCandidates({
      name: body.name,
      entries: body.entries,
      hints: body.hints,
    });
    send(res, 200, { ok: true, ...result });
  } catch {
    send(res, 500, { ok: false, error: 'scan-failed' });
  }
}

/**
 * Accept only same-origin callers; a non-browser caller sends no Origin.
 * @param ctx - Host root context.
 * @param req - Node request.
 * @returns whether the request may proceed.
 */
function sameOrigin(ctx, req) {
  const header = req.headers.origin;
  if (typeof header !== 'string' || header === '') return true;
  try {
    return header === ctx.webServer.getOrigin();
  } catch {
    return true;
  }
}

/**
 * Read and parse one JSON body within the size cap.
 * @param req - Node request.
 * @returns the parsed body.
 */
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('body-too-large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch {
        reject(new Error('invalid-json'));
      }
    });
    req.on('error', () => reject(new Error('read-failed')));
  });
}

/**
 * Write one JSON response.
 * @param res - Node response.
 * @param status - HTTP status.
 * @param payload - JSON-serializable body.
 */
function send(res, status, payload) {
  const text = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(text),
  });
  res.end(text);
}
