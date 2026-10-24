// Local save server: serves the editor and reads/writes .html files under a
// site root, so the editor can save real files from browsers without the
// File System Access API (iPad Safari, Firefox).
//
//   node server.js --root <site dir> --port <n> [--host 0.0.0.0]
//
// Node built-ins only. No auth — anyone who can reach the port can edit
// .html files under --root, so run it on a trusted network.
import http from 'node:http';
import fs from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const APP_DIR = path.dirname(fileURLToPath(import.meta.url));
const MAX_BODY = 20 * 1024 * 1024;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const inside = (dir, p) => p === dir || p.startsWith(dir + path.sep);

// Validate a client-supplied relative path and resolve it under root.
// Rejects absolute paths, any '..' segment, NUL bytes and non-.html files
// (400), and symlinks that resolve outside root (403).
async function resolveSitePath(rootReal, rel, { forWrite = false } = {}) {
  if (typeof rel !== 'string' || !rel || rel.includes('\0')) throw new HttpError(400, 'Missing or invalid path');
  if (path.isAbsolute(rel) || /^[\\/]/.test(rel) || /^[a-zA-Z]:/.test(rel)) throw new HttpError(400, 'Path must be relative to the site root');
  if (rel.split(/[\\/]/).includes('..')) throw new HttpError(400, 'Path must not contain ..');
  if (path.extname(rel).toLowerCase() !== '.html') throw new HttpError(400, 'Only .html files can be read or written');

  const full = path.resolve(rootReal, rel);
  if (!inside(rootReal, full) || full === rootReal) throw new HttpError(403, 'Path escapes the site root');

  let real;
  try {
    real = await fs.realpath(full);
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    if (!forWrite) throw new HttpError(404, 'File not found');
    // New file: its directory must exist and really live under root.
    let dirReal;
    try { dirReal = await fs.realpath(path.dirname(full)); }
    catch (_) { throw new HttpError(404, 'Directory not found'); }
    if (!inside(rootReal, dirReal)) throw new HttpError(403, 'Path escapes the site root');
    return path.join(dirReal, path.basename(full));
  }
  if (!inside(rootReal, real)) throw new HttpError(403, 'Path escapes the site root');
  if (path.extname(real).toLowerCase() !== '.html') throw new HttpError(403, 'Link target is not an .html file');
  const st = await fs.stat(real);
  if (!st.isFile()) throw new HttpError(400, 'Not a file');
  return real;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new HttpError(413, 'File too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// The editor itself: index.html at '/', plus js/ and css/ from the repo.
async function serveApp(res, pathname) {
  let rel;
  if (pathname === '/' || pathname === '/index.html') rel = 'index.html';
  else if (/^\/(js|css)\/[\w.-]+$/.test(pathname)) rel = pathname.slice(1);
  else throw new HttpError(404, 'Not found');
  const file = path.join(APP_DIR, rel);
  let body;
  try { body = await fs.readFile(file); }
  catch (_) { throw new HttpError(404, 'Not found'); }
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
    'Cache-Control': 'no-cache',
  });
  res.end(body);
}

export async function createHandler({ root }) {
  const rootReal = await fs.realpath(path.resolve(root));
  if (!(await fs.stat(rootReal)).isDirectory()) throw new Error(`--root is not a directory: ${root}`);

  return async function handle(req, res) {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/api/file') {
        const rel = url.searchParams.get('path');
        if (req.method === 'GET' || req.method === 'HEAD') {
          const file = await resolveSitePath(rootReal, rel);
          const body = await fs.readFile(file);
          // text/plain + nosniff: the editor reads this with fetch(); never
          // let the browser render site HTML at the editor's origin.
          res.writeHead(200, {
            'Content-Type': 'text/plain; charset=utf-8',
            'X-Content-Type-Options': 'nosniff',
            'Cache-Control': 'no-store',
          });
          res.end(req.method === 'HEAD' ? undefined : body);
          return;
        }
        if (req.method === 'PUT') {
          const origin = req.headers.origin;
          if (origin && origin !== 'null') {
            let host = null;
            try { host = new URL(origin).host; } catch (_) {}
            if (host !== req.headers.host) throw new HttpError(403, 'Cross-origin write refused');
          }
          const file = await resolveSitePath(rootReal, rel, { forWrite: true });
          const body = await readBody(req);
          await fs.writeFile(file, body);
          res.writeHead(204, { 'Cache-Control': 'no-store' });
          res.end();
          return;
        }
        throw new HttpError(405, 'Method not allowed');
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method not allowed');
      await serveApp(res, url.pathname);
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) console.error(e);
      res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(status === 500 ? 'Internal error' : e.message);
    }
  };
}

function parseArgs(argv) {
  const opts = { root: process.cwd(), port: 8080, host: '0.0.0.0' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--root') opts.root = argv[++i];
    else if (a === '--port') opts.port = Number(argv[++i]);
    else if (a === '--host') opts.host = argv[++i];
    else throw new Error(`Unknown argument: ${a}`);
  }
  if (!Number.isInteger(opts.port) || opts.port < 0 || opts.port > 65535) throw new Error('--port must be a number');
  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const handler = await createHandler(opts);
  const server = http.createServer(handler);
  server.on('error', (e) => { console.error(`Could not listen on ${opts.host}:${opts.port}: ${e.message}`); process.exit(1); });
  server.listen(opts.port, opts.host, () => {
    const { port } = server.address();
    console.log(`html-editor serving ${path.resolve(opts.root)}`);
    console.log(`  http://localhost:${port}/?file=index.html`);
    for (const list of Object.values(os.networkInterfaces())) {
      for (const a of list || []) {
        if (a.family === 'IPv4' && !a.internal) console.log(`  http://${a.address}:${port}/?file=index.html`);
      }
    }
  });
}

const isMain = () => {
  try { return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href; }
  catch (_) { return false; }
};
if (process.argv[1] && isMain()) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}
