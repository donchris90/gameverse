import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { z } from 'zod';
import { WebSocketServer, type WebSocket } from 'ws';
import { SessionAuthenticator } from '../auth/session-authenticator.js';
import { RealtimeHub } from './realtime.hub.js';

export const WS_PATH = '/ws';
const AUTH_TIMEOUT_MS = 5_000;
const HEARTBEAT_MS = 30_000;
const MAX_PAYLOAD_BYTES = 4 * 1024;
const FRAME_WINDOW_MS = 10_000;
const MAX_FRAMES_PER_WINDOW = 30;

const authFrame = z.object({ type: z.literal('auth'), token: z.string().min(1).max(4096) });
const pingFrame = z.object({ type: z.literal('ping') });

/**
 * WebSocket endpoint at /ws. The access token is sent as the first frame (not in the URL, so it
 * never reaches access logs). The socket is for delivery only; sending happens over REST, where
 * validation, idempotency, authorization and rate limits already live.
 *
 * Close codes: 4401 unauthenticated/expired, 4403 account unavailable, 4408 auth timeout,
 * 4409 superseded by a newer connection, 4429 too many frames.
 */
@Injectable()
export class RealtimeGateway implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(RealtimeGateway.name);
  private wss: WebSocketServer | null = null;
  private heartbeat: NodeJS.Timeout | null = null;

  constructor(
    private readonly adapterHost: HttpAdapterHost,
    private readonly sessions: SessionAuthenticator,
    private readonly hub: RealtimeHub,
  ) {}

  onApplicationBootstrap(): void {
    const server = this.adapterHost.httpAdapter.getHttpServer() as import('node:http').Server;
    const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD_BYTES });
    this.wss = wss;

    server.on('upgrade', (request, socket, head) => {
      const path = (request.url ?? '').split('?')[0];
      if (path !== WS_PATH) {
        socket.destroy();
        return;
      }
      wss.handleUpgrade(request, socket, head, (ws) => this.onConnection(ws));
    });

    this.heartbeat = setInterval(() => {
      for (const client of wss.clients) {
        const alive = (client as WebSocket & { isAlive?: boolean }).isAlive !== false;
        if (!alive) {
          client.terminate();
          continue;
        }
        (client as WebSocket & { isAlive?: boolean }).isAlive = false;
        client.ping();
      }
    }, HEARTBEAT_MS);
    this.heartbeat.unref();
  }

  onApplicationShutdown(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.hub.closeAll();
    this.wss?.close();
  }

  private onConnection(ws: WebSocket): void {
    const tagged = ws as WebSocket & { isAlive?: boolean };
    tagged.isAlive = true;
    ws.on('pong', () => {
      tagged.isAlive = true;
    });

    let userId: string | null = null;
    let authenticating = false;
    let expiryTimer: NodeJS.Timeout | null = null;
    let frames = 0;
    const windowTimer = setInterval(() => {
      frames = 0;
    }, FRAME_WINDOW_MS);
    const authTimer = setTimeout(() => {
      if (!userId) ws.close(4408, 'authentication timeout');
    }, AUTH_TIMEOUT_MS);

    const cleanup = (): void => {
      clearTimeout(authTimer);
      clearInterval(windowTimer);
      if (expiryTimer) clearTimeout(expiryTimer);
      if (userId) this.hub.unregister(userId, ws);
    };
    ws.on('close', cleanup);
    ws.on('error', () => ws.terminate());

    ws.on('message', (data, isBinary) => {
      frames += 1;
      if (frames > MAX_FRAMES_PER_WINDOW) {
        ws.close(4429, 'too many frames');
        return;
      }
      if (isBinary) {
        ws.close(1003, 'text frames only');
        return;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(data.toString('utf8'));
      } catch {
        ws.close(1007, 'invalid json');
        return;
      }

      if (!userId) {
        if (authenticating) {
          ws.close(4401, 'authentication already in progress');
          return;
        }
        const auth = authFrame.safeParse(parsed);
        if (!auth.success) {
          ws.close(4401, 'authenticate first');
          return;
        }
        authenticating = true;
        void this.authenticate(ws, auth.data.token).then((result) => {
          if (ws.readyState !== ws.OPEN) return;
          if (!result) return;
          userId = result.userId;
          clearTimeout(authTimer);
          this.hub.register(result.userId, ws);
          // Access tokens are short-lived; make the client reconnect with a fresh one at expiry.
          expiryTimer = setTimeout(
            () => ws.close(4401, 'token expired'),
            Math.max(0, result.expiresAtMs - Date.now()),
          );
          ws.send(JSON.stringify({ type: 'ready', userId: result.userId }));
        });
        return;
      }

      if (pingFrame.safeParse(parsed).success) {
        ws.send(JSON.stringify({ type: 'pong' }));
        return;
      }
      ws.send(JSON.stringify({ type: 'error', code: 'UNSUPPORTED' }));
    });
  }

  private async authenticate(
    ws: WebSocket,
    token: string,
  ): Promise<{ userId: string; expiresAtMs: number } | null> {
    try {
      const session = await this.sessions.authenticate(token);
      return { userId: session.user.id, expiresAtMs: session.tokenExpiresAtMs };
    } catch (error) {
      const code = (error as { code?: string }).code ?? '';
      const accountProblem = code.startsWith('ACCOUNT_');
      if (!accountProblem && !(error instanceof Error && 'getStatus' in error)) {
        this.logger.warn('Unexpected error while authenticating a WebSocket');
      }
      ws.close(
        accountProblem ? 4403 : 4401,
        accountProblem ? 'account unavailable' : 'unauthenticated',
      );
      return null;
    }
  }
}
