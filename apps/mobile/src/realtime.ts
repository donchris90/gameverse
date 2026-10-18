import { reconnectDelayMs, type RealtimeEvent } from '@gameverse/shared-types';
import { API_URL, freshAccessToken } from './http';

type Listener = (event: RealtimeEvent) => void;

const PING_INTERVAL_MS = 25_000;
const MAX_BACKOFF_MS = 30_000;

/**
 * One WebSocket for the signed-in user. Delivery only (sending is REST). It reconnects with
 * exponential backoff and a fresh access token each time; close code 4403 means the account is
 * unavailable (banned, suspended, deleted) so it stops and tells the app to sign out.
 */
class RealtimeClient {
  private socket: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private wanted = false;
  private attempts = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private fatalHandler: (() => void) | null = null;
  private connectedListeners = new Set<(connected: boolean) => void>();
  connected = false;

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onConnectionChange(listener: (connected: boolean) => void): () => void {
    this.connectedListeners.add(listener);
    return () => this.connectedListeners.delete(listener);
  }

  setFatalHandler(handler: (() => void) | null): void {
    this.fatalHandler = handler;
  }

  connect(): void {
    if (this.wanted) return;
    this.wanted = true;
    this.attempts = 0;
    void this.open();
  }

  disconnect(): void {
    this.wanted = false;
    this.clearTimers();
    const socket = this.socket;
    this.socket = null;
    socket?.close(1000, 'signed out');
    this.setConnected(false);
  }

  private setConnected(value: boolean): void {
    if (this.connected === value) return;
    this.connected = value;
    for (const listener of this.connectedListeners) listener(value);
  }

  private clearTimers(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.retryTimer = null;
    this.pingTimer = null;
  }

  private async open(): Promise<void> {
    if (!this.wanted || this.socket) return;
    const token = await freshAccessToken().catch(() => null);
    if (!this.wanted || this.socket) return;
    if (!token) return this.scheduleRetry();

    const url = `${API_URL.replace(/^http/, 'ws')}/ws`;
    const socket = new WebSocket(url);
    this.socket = socket;

    socket.onopen = () => {
      // The token travels in the first frame, never in the URL, so it stays out of server logs.
      socket.send(JSON.stringify({ type: 'auth', token }));
    };
    socket.onmessage = (message) => {
      let event: RealtimeEvent;
      try {
        event = JSON.parse(String(message.data)) as RealtimeEvent;
      } catch {
        return;
      }
      if (event.type === 'ready') {
        this.attempts = 0;
        this.setConnected(true);
        this.pingTimer = setInterval(() => {
          if (socket.readyState === 1) socket.send(JSON.stringify({ type: 'ping' }));
        }, PING_INTERVAL_MS);
      }
      for (const listener of this.listeners) listener(event);
    };
    socket.onclose = (event) => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.clearTimers();
      this.setConnected(false);
      if (!this.wanted) return;
      if (event.code === 4403) {
        this.wanted = false;
        this.fatalHandler?.();
        return;
      }
      // 4401 (token expired) retries immediately with a refreshed token; the rest back off.
      if (event.code === 4401) void this.open();
      else this.scheduleRetry();
    };
    socket.onerror = () => {
      // onclose follows and handles the retry.
    };
  }

  private scheduleRetry(): void {
    if (!this.wanted || this.retryTimer) return;
    this.attempts += 1;
    const delay = reconnectDelayMs(this.attempts, Math.random, MAX_BACKOFF_MS);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.open();
    }, delay);
  }
}

export const realtime = new RealtimeClient();
