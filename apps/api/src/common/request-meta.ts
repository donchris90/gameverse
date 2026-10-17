import type { Request } from 'express';

export interface RequestMeta {
  ip?: string;
  userAgent?: string;
}

export function requestMeta(request: Request): RequestMeta {
  const userAgent = request.headers['user-agent'];
  return {
    ip: request.ip,
    userAgent: typeof userAgent === 'string' ? userAgent.slice(0, 255) : undefined,
  };
}
