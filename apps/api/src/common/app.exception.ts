import { HttpException, type HttpStatus } from '@nestjs/common';
import type { ErrorCode } from '@gameverse/shared-types';

/**
 * The single exception type services throw for expected failures. The exception filter renders it
 * in the documented error envelope: { error: { code, message, details? }, requestId }.
 */
export class AppException extends HttpException {
  readonly code: ErrorCode;
  readonly details?: unknown;

  constructor(status: HttpStatus | number, code: ErrorCode, message: string, details?: unknown) {
    super(message, status);
    this.code = code;
    this.details = details;
  }
}
