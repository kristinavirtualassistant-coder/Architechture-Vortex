/**
 * Vortex One Dialer - Real-time WebSocket Server
 * Streams line updates, session state, call events, and queue counters to Agent Workspace.
 */

import { WebSocketServer, WebSocket } from 'ws';
import { Server as HttpServer } from 'http';
import { WSMessage } from '../types/dialer.js';

interface ClientConnection {
  ws: WebSocket;
  sessionId?: string;
  organizationId?: string;
  isAlive: boolean;
}

export class DialerWebSocketServer {
  private wss: WebSocketServer | null = null;
  private clients: Set<ClientConnection> = new Set();
  private pingInterval: NodeJS.Timeout | null = null;

  public initialize(server: HttpServer): void {
    this.wss = new WebSocketServer({ server, path: '/ws' });

    this.wss.on('connection', (ws: WebSocket) => {
      const client: ClientConnection = {
        ws,
        isAlive: true,
      };
      this.clients.add(client);

      ws.on('pong', () => {
        client.isAlive = true;
      });

      ws.on('message', (data: string) => {
        try {
          const parsed = JSON.parse(data.toString());
          if (parsed.action === 'subscribe') {
            client.sessionId = parsed.sessionId;
            client.organizationId = parsed.organizationId;
            ws.send(
              JSON.stringify({
                type: 'SESSION_STATE',
                sessionId: client.sessionId,
                timestamp: new Date().toISOString(),
                payload: { subscribed: true, sessionId: client.sessionId },
              })
            );
          }
        } catch (e) {
          // Ignore malformed json
        }
      });

      ws.on('close', () => {
        this.clients.delete(client);
      });

      ws.on('error', () => {
        this.clients.delete(client);
      });
    });

    // Heartbeat check every 30s
    this.pingInterval = setInterval(() => {
      this.clients.forEach((client) => {
        if (!client.isAlive) {
          client.ws.terminate();
          this.clients.delete(client);
          return;
        }
        client.isAlive = false;
        client.ws.ping();
      });
    }, 30000);
  }

  public broadcastToSession(sessionId: string, message: WSMessage): void {
    const payloadStr = JSON.stringify(message);
    this.clients.forEach((client) => {
      if (
        client.ws.readyState === WebSocket.OPEN &&
        (!client.sessionId || client.sessionId === sessionId)
      ) {
        client.ws.send(payloadStr);
      }
    });
  }

  public broadcastAll(message: WSMessage): void {
    const payloadStr = JSON.stringify(message);
    this.clients.forEach((client) => {
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(payloadStr);
      }
    });
  }

  public close(): void {
    if (this.pingInterval) clearInterval(this.pingInterval);
    if (this.wss) this.wss.close();
  }
}

export const dialerWsServer = new DialerWebSocketServer();
