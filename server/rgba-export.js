import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { setImmediate } from 'node:timers/promises';
import { CANVAS_WIDTH, CANVAS_HEIGHT } from '../src/canvas.js';
import { FPS } from '../src/timing.js';
import { RGBAScene } from '../src/rgba.js';
import { singleCanvasProject, serializeProject, MAX_PROJECT_BYTES } from '../src/project.js';

const RETENTION_MS = 60 * 60 * 1000;
export function createRGBAExports({ ffmpeg = process.env.DIRECT_PAINTING_FFMPEG || 'ffmpeg' } = {}) {
  const jobs = new Map(); let disposed = false;
  const removeFiles = async job => { if (job.folder) await rm(job.folder, { recursive: true, force: true }).catch(() => {}); };
  const json = (res, code, data) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
  const describe = job => ({ id: job.id, state: job.state, progress: job.progress, error: job.error, format: job.format, fps: FPS, stamp: job.stamp, createdAt: job.createdAt, expiresAt: job.expiresAt, duration: job.frames / FPS * 1000,
    ...(job.state === 'ready' ? { projectURL: `/api/export/${job.id}/project.json`, files: ['painting'].map(side => {
      const primary = `${side}.${job.format === 'rgba' ? 'mov' : 'mp4'}`, preview = job.format === 'rgba' ? `${side}-preview.mp4` : primary;
      return { side, extension: primary.split('.').at(-1), url: `/api/export/${job.id}/${primary}`, filename: `direct-painting-${job.stamp}-${primary}`, previewURL: `/api/export/${job.id}/${preview}?inline=1`, previewDownloadURL: `/api/export/${job.id}/${preview}`, previewFilename: `direct-painting-${job.stamp}-${preview}` };
    }) } : {}) });
  async function encode(job, side, scene) {
    let stderr = '', spawnError;
    const primary = job.format === 'rgba' ? `${side}.mov` : `${side}.mp4`, preview = `${side}-preview.mp4`;
    const rgb = 'format=gbrap,premultiply=inplace=1:planes=7,scale=in_range=full:out_range=tv:out_color_matrix=bt709,format=yuv420p,setsar=1';
    const graph = job.format === 'rgba' ? `[0:v]split=2[m][p];[m]scale=in_range=full:out_range=tv:out_color_matrix=bt709,format=yuva444p10le,setsar=1[master];[p]${rgb}[preview]` : `[0:v]${rgb}[preview]`;
    const tags = ['-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-color_range', 'tv', '-movflags', '+faststart'];
    const args = ['-hide_banner', '-loglevel', 'error', '-f', 'rawvideo', '-pixel_format', 'rgba', '-video_size', `${CANVAS_WIDTH}x${CANVAS_HEIGHT}`, '-framerate', String(FPS), '-i', 'pipe:0', '-filter_complex_threads', '1', '-filter_complex', graph, '-y'];
    if (job.format === 'rgba') args.push('-map', '[master]', '-an', '-c:v', 'prores_ks', '-profile:v', '4444', '-pix_fmt', 'yuva444p10le', '-alpha_bits', '16', '-vendor', 'apl0', '-qscale:v', '4', '-threads', '2', ...tags, join(job.folder, primary));
    args.push('-map', '[preview]', '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-tag:v', 'avc1', '-threads', '2', ...tags, join(job.folder, job.format === 'rgba' ? preview : primary));
    const child = spawn(ffmpeg, args, { stdio: ['pipe', 'ignore', 'pipe'] });
    job.child = child;
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-4096); });
    const finished = new Promise((resolve, reject) => {
      child.once('error', error => { spawnError = new Error(error.code === 'ENOENT' ? 'FFmpeg is required for video export. Install FFmpeg on the server and restart.' : error.message); reject(spawnError); });
      child.once('close', code => code === 0 ? resolve() : reject(new Error(job.cancelled ? 'Export cancelled' : stderr || `FFmpeg exited with code ${code}`)));
    });
    async function* frames() {
      for (let frame = 0; frame < job.frames; frame++) {
        if (job.cancelled) throw new Error('Export cancelled');
        yield Buffer.from(scene.draw(0, frame * 1000 / FPS));
        job.progress = (frame + 1) / job.frames;
        await setImmediate();
      }
    }
    try { await Promise.all([pipeline(Readable.from(frames()), child.stdin), finished]); }
    catch (error) { child.kill(); await finished.catch(() => {}); if (job.cancelled) throw new Error('Export cancelled'); if (stderr) throw new Error(stderr); throw spawnError || error; }
    finally { job.child = null; }
  }
  async function run(job, project, playback) {
    try {
      job.folder = await mkdtemp(join(tmpdir(), 'direct-painting-export-'));
      await writeFile(join(job.folder, 'project.json'), serializeProject(project, playback));
      const scene = new RGBAScene(project);
      await encode(job, 'painting', scene);
      if (job.cancelled) throw new Error('Export cancelled');
      job.state = 'ready'; job.progress = 1;
    } catch (error) { job.state = job.cancelled ? 'cancelled' : 'error'; job.error = error.message; await removeFiles(job); }
    finally {
      if (!disposed) {
        job.expiresAt = Date.now() + RETENTION_MS;
        job.expiry = setTimeout(() => { jobs.delete(job.id); void removeFiles(job); }, RETENTION_MS); job.expiry.unref();
      }
    }
  }
  async function sendFile(req, res, job, name, inline) {
    const path = join(job.folder, name), size = (await stat(path)).size;
    const mime = name.endsWith('.mov') ? 'video/quicktime' : name.endsWith('.mp4') ? 'video/mp4' : 'application/json';
    const filename = name === 'project.json' ? `direct-painting-${job.stamp}.json` : `direct-painting-${job.stamp}-${name}`;
    const headers = { 'Content-Type': mime, 'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${filename}"`, 'Cache-Control': 'no-store', 'Accept-Ranges': 'bytes' };
    let start = 0, end = size - 1, status = 200;
    if (req.headers.range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
      if (!match || (!match[1] && !match[2])) { res.writeHead(416, { 'Content-Range': `bytes */${size}` }); res.end(); return; }
      start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
      end = match[1] && match[2] ? Math.min(size - 1, Number(match[2])) : size - 1;
      if (start >= size || start > end) { res.writeHead(416, { 'Content-Range': `bytes */${size}` }); res.end(); return; }
      status = 206; headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
    }
    headers['Content-Length'] = end - start + 1; res.writeHead(status, headers);
    if (req.method === 'HEAD') { res.end(); return; }
    const stream = createReadStream(path, { start, end });
    stream.on('error', () => res.destroy()); res.on('close', () => stream.destroy()); stream.pipe(res);
  }
  const middleware = async (req, res, next) => {
    const url = new URL(req.url, 'http://localhost'), parts = url.pathname.split('/').filter(Boolean);
    if (parts[0] !== 'api' || parts[1] !== 'export') return next();
    try {
      if (parts.length === 2 && req.method === 'GET') return json(res, 200, { exports: [...jobs.values()].sort((a, b) => b.createdAt - a.createdAt).map(describe) });
      if (parts.length === 2 && req.method === 'POST') {
        if (!req.headers['content-type']?.startsWith('application/json')) return json(res, 415, { error: 'Expected a JSON project' });
        const chunks = []; let bytes = 0;
        for await (const chunk of req) { bytes += chunk.length; if (bytes > MAX_PROJECT_BYTES) throw new Error('Project exceeds 16MB'); chunks.push(chunk); }
        const input = JSON.parse(Buffer.concat(chunks).toString()), project = singleCanvasProject(input.project), format = input.format ?? 'rgba';
        if (!['rgba', 'rgb'].includes(format)) throw new Error('Invalid export format');
        const playback = input.playback ?? { playing: false, phase: 0 };
        if (typeof playback.playing !== 'boolean' || !Number.isFinite(playback.phase) || playback.phase < 0) throw new Error('Invalid export playback');
        if ([...jobs.values()].some(job => job.state === 'running')) return json(res, 409, { error: 'Another export is in progress. Try again when it finishes.' });
        const frames = Math.ceil(project.duration * FPS / 1000);
        if (frames > FPS * 600) throw new Error('Video exports support loops up to 10 minutes');
        const job = { id: randomUUID(), state: 'running', progress: 0, frames, format, cancelled: false, createdAt: Date.now(), stamp: /^\d{8}-\d{6}$/.test(input.stamp) ? input.stamp : 'loop' };
        jobs.set(job.id, job); job.done = run(job, project, playback);
        return json(res, 201, { id: job.id });
      }
      const job = jobs.get(parts[2]);
      if (!job) return json(res, 404, { error: 'Export expired or not found. Export the loop again.' });
      if (parts.length === 3 && req.method === 'GET') return json(res, 200, describe(job));
      if (parts.length === 3 && req.method === 'DELETE') {
        if (job.state === 'running') { job.cancelled = true; job.child?.kill(); }
        else { jobs.delete(job.id); clearTimeout(job.expiry); await removeFiles(job); }
        return json(res, 200, { state: 'cancelled' });
      }
      const names = job.format === 'rgba' ? ['painting.mov', 'painting-preview.mp4', 'project.json'] : ['painting.mp4', 'project.json'];
      if (parts.length === 4 && ['GET', 'HEAD'].includes(req.method) && names.includes(parts[3]) && job.state === 'ready') { await sendFile(req, res, job, parts[3], url.searchParams.get('inline') === '1'); return; }
      return json(res, 405, { error: 'Unsupported export request' });
    } catch (error) { if (res.headersSent) res.destroy(); else json(res, 400, { error: error.message }); }
  };
  return { middleware, async dispose() {
    disposed = true;
    for (const job of jobs.values()) { job.cancelled = true; job.child?.kill(); }
    await Promise.all([...jobs.values()].map(async job => { await job.done; clearTimeout(job.expiry); await removeFiles(job); })); jobs.clear();
  } };
}
