/**
 * Vortex One Dialer - Server Entry Point
 * Express API + WebSocket Gateway + Vite Middleware
 */

import express from 'express';
import http from 'http';
import path from 'path';
import dotenv from 'dotenv';
import { dialerApiRouter } from './src/routes/dialerApi.js';
import { aiApiRouter } from './src/routes/aiApi.js';
import { dialerWsServer } from './src/websocket/dialerWs.js';
import { liveVoiceGateway } from './src/websocket/liveVoiceWs.js';
import { db } from './src/db/db.js';
import { createServer as createViteServer } from 'vite';

dotenv.config();

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;
  const server = http.createServer(app);

  // Parse JSON bodies and urlencoded
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));

  // Initialize Database
  await db.initialize();

  // Initialize WebSocket Servers on /ws and /live-voice
  dialerWsServer.initialize(server);
  liveVoiceGateway.initialize(server);

  // Mount API Routers First
  app.use('/api/v1/ai', aiApiRouter);
  app.use('/api/ai', aiApiRouter);
  app.use('/api/v1', dialerApiRouter);
  app.use('/api', dialerApiRouter);

  // Vite Middleware for SPA Frontend
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`⚡ Vortex One Dialer server running on http://0.0.0.0:${PORT}`);
  });

  // Graceful shutdown handling (SIGTERM, SIGINT)
  const handleShutdown = async (signal: string) => {
    console.log(`\n🛑 Received ${signal}. Initiating graceful shutdown...`);
    try {
      dialerWsServer.close();
      liveVoiceGateway.close();
      await db.close();
      server.close(() => {
        console.log('✅ HTTP and WebSocket servers closed successfully.');
        process.exit(0);
      });
      // Force exit after 5s timeout if lingering handles exist
      setTimeout(() => {
        console.warn('⚠️ Forcefully exiting after shutdown timeout.');
        process.exit(0);
      }, 5000).unref();
    } catch (err) {
      console.error('Error during shutdown:', err);
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => handleShutdown('SIGTERM'));
  process.on('SIGINT', () => handleShutdown('SIGINT'));
}

startServer().catch((err) => {
  console.error('Fatal error starting Vortex One Dialer server:', err);
  process.exit(1);
});
