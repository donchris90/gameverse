import { Injectable } from '@nestjs/common';
import type { RealtimeEvent } from '@gameverse/shared-types';
import type { WebSocket } from 'ws';

export const MAX_SOCKETS_PER_USER = 5;

/**
 * In-memory registry of authenticated sockets, keyed by user id. Single-instance by design (see
 * docs/decisions.md): running more than one API instance requires a shared pub/sub first.
 */
@Injectable()
export class RealtimeHub {
  private readonly sockets = new Map<string, Set<WebSocket>>();
  private readonly readyListeners: ((userId: string, socket: WebSocket) => void)[] = [];
  private readonly presenceListeners: ((userId: string, online: boolean) => void)[] = [];

  /** Called when a user's first socket connects (true) or their last one goes away (false). */
  onPresenceChange(listener: (userId: string, online: boolean) => void): void {
    this.presenceListeners.push(listener);
  }

  /** Called for every authenticated socket right after it receives `ready` (including 2nd devices). */
  onSocketReady(listener: (userId: string, socket: WebSocket) => void): void {
    this.readyListeners.push(listener);
  }

  notifySocketReady(userId: string, socket: WebSocket): void {
    for (const listener of this.readyListeners) {
      try {
        listener(userId, socket);
      } catch {
        // a faulty listener must never break socket handling
      }
    }
  }

  /** Sends to one socket only (a snapshot for a client that just connected). */
  sendToSocket(socket: WebSocket, event: RealtimeEvent): void {
    if (socket.readyState !== socket.OPEN) return;
    try {
      socket.send(JSON.stringify(event));
    } catch {
      socket.terminate();
    }
  }

  private emitPresence(userId: string, online: boolean): void {
    for (const listener of this.presenceListeners) {
      try {
        listener(userId, online);
      } catch {
        // a faulty listener must never break socket handling
      }
    }
  }

  register(userId: string, socket: WebSocket): void {
    let set = this.sockets.get(userId);
    const wasOffline = !set || set.size === 0;
    if (!set) {
      set = new Set();
      this.sockets.set(userId, set);
    }
    set.add(socket);
    if (wasOffline) this.emitPresence(userId, true);
    // Cap concurrent connections per account: drop the oldest beyond the limit.
    while (set.size > MAX_SOCKETS_PER_USER) {
      const oldest = set.values().next().value;
      if (!oldest) break;
      set.delete(oldest);
      oldest.close(4409, 'too many connections');
    }
  }

  unregister(userId: string, socket: WebSocket): void {
    const set = this.sockets.get(userId);
    if (!set) return;
    if (!set.delete(socket)) return;
    if (set.size === 0) {
      this.sockets.delete(userId);
      this.emitPresence(userId, false);
    }
  }

  isOnline(userId: string): boolean {
    return (this.sockets.get(userId)?.size ?? 0) > 0;
  }

  /** Sends to every open socket of the user. Never throws: delivery is best effort. */
  publishToUser(userId: string, event: RealtimeEvent): void {
    const set = this.sockets.get(userId);
    if (!set) return;
    const frame = JSON.stringify(event);
    for (const socket of set) {
      if (socket.readyState !== socket.OPEN) continue;
      try {
        socket.send(frame);
      } catch {
        socket.terminate();
      }
    }
  }

  /** Closes every socket of a user (ban, suspension, deletion). */
  disconnectUser(userId: string, code = 4403, reason = 'account unavailable'): void {
    const set = this.sockets.get(userId);
    if (!set) return;
    for (const socket of set) socket.close(code, reason);
    this.sockets.delete(userId);
    this.emitPresence(userId, false);
  }

  closeAll(): void {
    for (const set of this.sockets.values())
      for (const socket of set) socket.close(1001, 'server shutting down');
    this.sockets.clear();
  }
}
