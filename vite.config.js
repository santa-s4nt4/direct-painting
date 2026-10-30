import { defineConfig } from 'vite';
import { createServer, request as proxyRequest } from 'node:http';
import { resolve } from 'node:path';
import { createLoopRelay } from './server/loop-relay.js';
import { connectionInfo } from './server/network.js';

const editorPort = Number(process.env.DIRECT_PAINTING_EDITOR_PORT || 5180);
const outputPort = Number(process.env.DIRECT_PAINTING_OUTPUT_PORT || 5181);

function outputs() {
  async function attach(server) {
    const relay = await createLoopRelay(process.env.DIRECT_PAINTING_CACHE_FILE || resolve(server.config.root, '.direct-painting/loop.json'), { midi: true });
    server.httpServer.once('close', () => relay.dispose());
    server.middlewares.use((request, response, next) => { relay(request, response, next).catch(next); });
    server.middlewares.use((request, response, next) => {
      if (!request.url?.startsWith('/api/')) return next();
      response.writeHead(404, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ error: 'API not found' }));
    });
    const mirror = createServer((request, response) => {
      const port = server.httpServer.address()?.port;
      if (!port) { response.writeHead(503); response.end(); return; }
      const proxy = proxyRequest({ hostname: '127.0.0.1', port, path: request.url, method: request.method, headers: { ...request.headers, connection: 'close' } }, upstream => {
        response.writeHead(upstream.statusCode, upstream.headers); upstream.pipe(response);
      });
      proxy.on('error', () => { if (!response.headersSent) response.writeHead(502); response.end(); });
      request.pipe(proxy);
    });
    const start = () => mirror.listen(outputPort, '0.0.0.0');
    const printUrls = server.printUrls.bind(server);
    server.printUrls = () => {
      printUrls();
      const printConnections = async () => {
        const editorAddress = server.httpServer.address(), outputAddress = mirror.address();
        if (!editorAddress || !outputAddress) return;
        server.config.logger.info(await connectionInfo(editorAddress.port, outputAddress.port));
      };
      if (mirror.listening) void printConnections();
      else mirror.once('listening', () => { void printConnections(); });
    };
    mirror.on('error', error => console.error(`Output server on port ${outputPort} failed: ${error.message}`));
    server.httpServer.once('listening', start);
    server.httpServer.once('close', () => { mirror.closeAllConnections(); mirror.close(); });
  }
  return { name: 'direct-painting-output', configureServer: attach, configurePreviewServer: attach };
}

export default defineConfig({
  plugins: [outputs()],
  build: { rollupOptions: { input: { main: resolve(import.meta.dirname, 'index.html'), renderChecks: resolve(import.meta.dirname, 'benchmarks/render.html'), trail: resolve(import.meta.dirname, 'benchmarks/trail.html'), volume: resolve(import.meta.dirname, 'benchmarks/volume.html'), motion: resolve(import.meta.dirname, 'benchmarks/motion.html'), gpuLoad: resolve(import.meta.dirname, 'benchmarks/gpu-load.html') } } },
  server: { host: '0.0.0.0', port: editorPort, strictPort: true, hmr: { clientPort: editorPort }, watch: { ignored: ['**/.direct-painting/**'] } },
  preview: { host: '0.0.0.0', port: 4180, strictPort: true },
});
