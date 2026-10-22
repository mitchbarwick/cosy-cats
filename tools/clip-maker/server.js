// Placeholder clip maker (dev only). Serves the project, takes PNG frames rendered from the
// procedural rig by tools/clip-maker/index.html and encodes them with ffmpeg into
// assets/cats/<cat>/<clip>.webm (VP9 with alpha), the same layout real Blender renders use.
//
//   node tools/clip-maker/server.js   then open http://localhost:5174/tools/clip-maker/
//
// Needs ffmpeg on PATH (winget install Gyan.FFmpeg), or set FFMPEG to the exe or its folder.
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const root = path.resolve(__dirname, '..', '..');
const port = process.env.PORT || 5174;
let ffmpeg = process.env.FFMPEG || 'ffmpeg';
try { if (fs.statSync(ffmpeg).isDirectory()) ffmpeg = path.join(ffmpeg, 'ffmpeg'); } catch {} // FFMPEG may name its folder
const framesRoot = path.join(os.tmpdir(), 'cosy-cats-frames');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webm': 'video/webm' };
const NAME = /^[a-zA-Z0-9-]+$/;

function body(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function encode(cat, clip, fps) {
  const src = path.join(framesRoot, cat, clip, '%04d.png');
  const outDir = path.join(root, 'assets', 'cats', cat);
  fs.mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, `${clip}.webm`);
  const args = ['-y', '-loglevel', 'error', '-framerate', String(fps), '-i', src,
    '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-b:v', '0', '-crf', '32',
    '-auto-alt-ref', '0', '-row-mt', '1', '-deadline', 'good', '-cpu-used', '2', out];
  return new Promise((resolve) => {
    const p = spawn(ffmpeg, args);
    let err = '';
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', (e) => resolve({ ok: false, error: String(e) }));
    p.on('close', (code) => resolve({ ok: code === 0, error: err.trim(), bytes: code === 0 ? fs.statSync(out).size : 0 }));
  });
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const q = Object.fromEntries(url.searchParams);
  const json = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
  try {
    if (req.method === 'POST') {
      if (!NAME.test(q.cat || '') || (q.clip && !NAME.test(q.clip))) return json(400, { error: 'bad name' });
      const dir = path.join(framesRoot, q.cat, q.clip || '');
      if (url.pathname === '/api/begin') {
        fs.rmSync(dir, { recursive: true, force: true });
        fs.mkdirSync(dir, { recursive: true });
        return json(200, { ok: true });
      }
      if (url.pathname === '/api/frame') {
        const i = parseInt(q.i, 10);
        if (!(i >= 0 && i < 10000)) return json(400, { error: 'bad index' });
        fs.writeFileSync(path.join(dir, `${String(i).padStart(4, '0')}.png`), await body(req));
        return json(200, { ok: true });
      }
      if (url.pathname === '/api/encode') return json(200, await encode(q.cat, q.clip, parseInt(q.fps, 10) || 24));
      if (url.pathname === '/api/manifest') {
        const manifest = JSON.parse((await body(req)).toString('utf8'));
        const outDir = path.join(root, 'assets', 'cats', q.cat);
        fs.mkdirSync(outDir, { recursive: true });
        fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
        return json(200, { ok: true });
      }
      return json(404, { error: 'unknown endpoint' });
    }
    const rel = decodeURIComponent(url.pathname);
    let file = path.normalize(path.join(root, rel));
    if (!file.startsWith(root)) { res.writeHead(403); return res.end(); }
    if (rel.endsWith('/')) file = path.join(file, 'index.html');
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); return res.end('Not found'); }
      res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(data);
    });
  } catch (e) {
    json(500, { error: String(e) });
  }
}).listen(port, '127.0.0.1', () => console.log(`Clip maker on http://localhost:${port}/tools/clip-maker/`));
