import { CANVAS_WIDTH, CANVAS_HEIGHT } from '../src/canvas.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createRGBAExports } from '../server/rgba-export.js';
const exec = promisify(execFile);
const available = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0 && spawnSync('ffprobe', ['-version'], { stdio: 'ignore' }).status === 0;
const clip = color => ({ id: color, mode: 'return', color, targets: [0, 1], enabled: true, start: 0, duration: 200, fadeMs: 1000, samples: [{ x: 100, y: 100, size: 40, t: 0 }, { x: 100, y: 100, size: 40, t: 200 }] });
async function serve(options) {
  const exports = createRGBAExports(options), server = createServer((req, res) => exports.middleware(req, res, () => { res.writeHead(404); res.end(); }).catch(error => res.destroy(error)));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${server.address().port}/api/export`, async close() { await exports.dispose(); await new Promise(resolve => server.close(resolve)); } };
}
async function wait(url) {
  for (let attempt = 0; attempt < 1500; attempt++) { const status = await (await fetch(url)).json(); if (status.state !== 'running') return status; await delay(20); }
  throw new Error('RGBA export timed out');
}
test('ProRes MOV downloads retain 1920 × 1080 RGB at fixed 60fps plus alpha and include H.264 preview copies', { skip: !available }, async () => {
  const server = await serve(), folder = await mkdtemp(join(tmpdir(), 'direct-painting-export-test-'));
  try {
    const response = await fetch(server.url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project: { version: 1, duration: 1500, clips: [clip('#ff0000')], settings: { blurRadius: 160 } } }) });
    assert.equal(response.status, 201); const { id } = await response.json();
    const status = await wait(`${server.url}/${id}`); assert.equal(status.state, 'ready', status.error);
    for (const side of ['painting']) {
      const response = await fetch(`${server.url}/${id}/${side}.mov`); assert.equal(response.headers.get('content-type'), 'video/quicktime');
      const path = join(folder, `${side}.mov`); await writeFile(path, Buffer.from(await response.arrayBuffer()));
      const { stdout: info } = await exec('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name,pix_fmt,width,height,nb_frames,avg_frame_rate', '-of', 'json', path]);
      assert.deepEqual(JSON.parse(info).streams[0], { codec_name: 'prores', width: CANVAS_WIDTH, height: CANVAS_HEIGHT, pix_fmt: 'yuva444p12le', avg_frame_rate: '60/1', nb_frames: '90' });
      for (const [frame, alpha] of [[0, 255], [42, 64], [80, 0]]) {
        const { stdout: pixels } = await exec('ffmpeg', ['-v', 'error', '-i', path, '-vf', `select=eq(n\\,${frame})`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1'], { encoding: 'buffer', maxBuffer: 12 * 1024 * 1024 });
        assert.equal(pixels.length, CANVAS_WIDTH * CANVAS_HEIGHT * 4);
        assert.equal(pixels[3], 0);
        const offset = (100 * CANVAS_WIDTH + 100) * 4;
        assert.ok(Math.abs(pixels[offset + 3] - alpha) <= 1);
        if (alpha) { assert.ok(pixels[offset] >= 252); assert.ok(pixels[offset + 1] <= 3 && pixels[offset + 2] <= 3); }
      }
      const preview = await fetch(`${server.url}/${id}/${side}-preview.mp4`);
      const previewPath = join(folder, `${side}.mp4`); await writeFile(previewPath, Buffer.from(await preview.arrayBuffer()));
      const { stdout: previewInfo } = await exec('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,pix_fmt,width,height,avg_frame_rate', '-of', 'json', previewPath]);
      assert.deepEqual(JSON.parse(previewInfo).streams[0], { codec_name: 'h264', width: CANVAS_WIDTH, height: CANVAS_HEIGHT, pix_fmt: 'yuv420p', avg_frame_rate: '60/1' });
      const { stdout: view } = await exec('ffmpeg', ['-v', 'error', '-i', previewPath, '-vf', 'select=eq(n\\,42)', '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1'], { encoding: 'buffer', maxBuffer: 12 * 1024 * 1024 });
      const center = (100 * CANVAS_WIDTH + 100) * 4;
      assert.ok(Math.abs(view[center] - 64) <= 4); assert.ok(view[center + 1] <= 3 && view[center + 2] <= 3); assert.equal(view[center + 3], 255);
    }
  } finally { await server.close(); await rm(folder, { recursive: true }); }
});
test('missing FFmpeg fails explicitly without producing a fake RGBA download', async () => {
  const server = await serve({ ffmpeg: '/nonexistent/direct-painting-ffmpeg' });
  try {
    const response = await fetch(server.url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project: { version: 1, duration: 1500, clips: [clip('#000000')] } }) });
    const { id } = await response.json(), status = await wait(`${server.url}/${id}`);
    assert.equal(status.state, 'error'); assert.match(status.error, /FFmpeg is required/);
    assert.equal((await fetch(`${server.url}/${id}/painting.mov`)).status, 405);
  } finally { await server.close(); }
});

test('active RGBA export can be cancelled without exposing partial MOV files', { skip: !available }, async () => {
  const server = await serve();
  const request = () => fetch(server.url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project: { version: 1, duration: 600000, clips: [clip('#ff0000')] } }) });
  try {
    const response = await request(), { id } = await response.json();
    assert.equal(response.status, 201); assert.equal((await request()).status, 409);
    assert.equal((await fetch(`${server.url}/${id}`, { method: 'DELETE' })).status, 200);
    const status = await wait(`${server.url}/${id}`); assert.equal(status.state, 'cancelled');
    assert.equal((await fetch(`${server.url}/${id}/painting.mov`)).status, 405);
  } finally { await server.close(); }
});


test('shared export library exposes immutable JSON and range-seekable videos to another client', { skip: !available }, async () => {
  const server = await serve();
  try {
    const project = { version: 1, duration: 1500, clips: [clip('#ff0000'), { ...clip('#0000ff'), enabled: false }], settings: { blurRadius: 123 } };
    const response = await fetch(server.url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project, stamp: '20261017-181234', playback: { playing: false, phase: 700 } }) });
    const { id } = await response.json(); project.clips[0].color = '#00ff00';
    const status = await wait(`${server.url}/${id}`); assert.equal(status.state, 'ready', status.error);
    const list = await (await fetch(server.url)).json(); assert.equal(list.exports.length, 1); assert.equal(list.exports[0].id, id); assert.ok(list.exports[0].expiresAt > Date.now());
    const jsonResponse = await fetch(`${server.url}/${id}/project.json`), saved = await jsonResponse.json();
    assert.equal(jsonResponse.headers.get('content-type'), 'application/json'); assert.match(jsonResponse.headers.get('content-disposition'), /direct-painting-20261017-181234.json/);
    assert.equal(saved.project.clips[0].color, '#ff0000'); assert.equal(saved.project.clips[1].enabled, false); assert.equal(saved.project.settings.blurRadius, 123); assert.deepEqual(saved.playback, { playing: false, phase: 700 });
    const file = status.files[0]; assert.equal(file.extension, 'mov'); assert.equal(file.previewFilename, 'direct-painting-20261017-181234-painting-preview.mp4');
    const head = await fetch(`${server.url}/${id}/painting-preview.mp4`, { method: 'HEAD' }); assert.equal(head.status, 200); const size = Number(head.headers.get('content-length')); assert.ok(size > 100); assert.equal(head.headers.get('accept-ranges'), 'bytes');
    const range = await fetch(`${server.url}/${id}/painting-preview.mp4?inline=1`, { headers: { Range: 'bytes=0-31' } }); assert.equal(range.status, 206); assert.equal((await range.arrayBuffer()).byteLength, 32); assert.equal(range.headers.get('content-range'), `bytes 0-31/${size}`); assert.match(range.headers.get('content-disposition'), /^inline/);
    assert.equal((await fetch(`${server.url}/${id}/painting-preview.mp4`, { headers: { Range: 'bytes=999999999-' } })).status, 416);
  } finally { await server.close(); }
});

test('RGB exports also use shared H.264 MP4 downloads and JSON', { skip: !available }, async () => {
  const server = await serve();
  try {
    const response = await fetch(server.url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ format: 'rgb', project: { version: 1, duration: 1500, clips: [clip('#000000')] } }) });
    const { id } = await response.json(), status = await wait(`${server.url}/${id}`);
    assert.equal(status.state, 'ready', status.error); assert.equal(status.format, 'rgb'); assert.equal(status.fps, 60); assert.equal(status.files.length, 1); assert.equal(status.files[0].extension, 'mp4');
    assert.equal((await fetch(`${server.url}/${id}/painting.mp4`)).headers.get('content-type'), 'video/mp4'); assert.equal((await fetch(`${server.url}/${id}/project.json`)).status, 200);
    assert.equal((await fetch(`${server.url}/${id}`, { method: 'DELETE' })).status, 200); assert.equal((await (await fetch(server.url)).json()).exports.length, 0);
  } finally { await server.close(); }
});
