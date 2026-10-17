import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { ErrorCode, type ApiErrorBody } from '@gameverse/shared-types';
import type { Request, Response } from 'express';
import { AppException } from './app.exception.js';

const STATUS_TO_CODE: Record<number, ErrorCode> = {
  400: ErrorCode.VALIDATION_FAILED,
  401: ErrorCode.UNAUTHENTICATED,
  403: ErrorCode.FORBIDDEN,
  404: ErrorCode.NOT_FOUND,
  409: ErrorCode.CONFLICT,
  413: ErrorCode.VALIDATION_FAILED,
  415: ErrorCode.VALIDATION_FAILED,
  429: ErrorCode.RATE_LIMITED,
  503: ErrorCode.SERVICE_UNAVAILABLE,
};

/** Duck-typed body-parser / http-errors failures (they are not Nest HttpExceptions). */
function httpStatusOf(exception: unknown): number | undefined {
  if (typeof exception !== 'object' || exception === null) return undefined;
  const candidate = (exception as { status?: unknown; statusCode?: unknown }).status;
  const fallback = (exception as { statusCode?: unknown }).statusCode;
  const value = typeof candidate === 'number' ? candidate : fallback;
  return typeof value === 'number' && value >= 400 && value < 500 ? value : undefined;
}

/**
 * Renders every error in one envelope and never leaks internals: unexpected errors are logged with
 * their stack server-side and returned to the client as a generic 500.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const response = http.getResponse<Response>();
    const request = http.getRequest<Request & { id?: string }>();

    const requestId =
      typeof request.id === 'string' ? request.id : (response.getHeader('x-request-id') as string);

    let status: number;
    let body: ApiErrorBody['error'];

    if (exception instanceof AppException) {
      status = exception.getStatus();
      body = {
        code: exception.code,
        message: exception.message,
        ...(exception.details !== undefined ? { details: exception.details } : {}),
      };
    } else if (exception instanceof ThrottlerException) {
      status = HttpStatus.TOO_MANY_REQUESTS;
      body = { code: ErrorCode.RATE_LIMITED, message: 'Too many requests. Please slow down.' };
      response.setHeader('Retry-After', String(this.retryAfterSeconds(response)));
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      body = {
        code: STATUS_TO_CODE[status] ?? ErrorCode.INTERNAL_ERROR,
        message: status === 404 ? 'Resource not found' : exception.message,
      };
    } else if (httpStatusOf(exception) !== undefined) {
      // e.g. malformed JSON or oversized body rejected by the body parser
      status = httpStatusOf(exception) as number;
      body = {
        code: STATUS_TO_CODE[status] ?? ErrorCode.VALIDATION_FAILED,
        message: status === 413 ? 'Request body is too large' : 'The request could not be parsed',
      };
    } else {
      status = HttpStatus.INTERNAL_SERVER_ERROR;
      body = { code: ErrorCode.INTERNAL_ERROR, message: 'Something went wrong. Please try again.' };
      this.logger.error(
        { requestId, err: exception instanceof Error ? exception.message : 'non-error thrown' },
        exception instanceof Error ? exception.stack : undefined,
      );
    }

    const payload: ApiErrorBody = { error: body, ...(requestId ? { requestId } : {}) };
    response.status(status).json(payload);
  }

  /**
   * The throttler guard writes one `Retry-After-<limiter>` header per named limiter that tripped.
   * Clients only understand the standard `Retry-After`, so surface the longest wait among them.
   */
  private retryAfterSeconds(response: Response): number {
    const waits = Object.keys(response.getHeaders())
      .filter((name) => name.toLowerCase().startsWith('retry-after'))
      .map((name) => Number(response.getHeader(name)))
      .filter((seconds) => Number.isFinite(seconds) && seconds > 0);
    return waits.length > 0 ? Math.ceil(Math.max(...waits)) : 60;
  }
}
