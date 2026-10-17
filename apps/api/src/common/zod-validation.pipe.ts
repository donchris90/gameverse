import { HttpStatus, type PipeTransform } from '@nestjs/common';
import { ErrorCode } from '@gameverse/shared-types';
import type { ZodType, z } from 'zod';
import { AppException } from './app.exception.js';

/** Validates and transforms request payloads with a shared zod schema. */
export class ZodValidationPipe<S extends ZodType> implements PipeTransform<unknown, z.output<S>> {
  constructor(private readonly schema: S) {}

  transform(value: unknown): z.output<S> {
    const result = this.schema.safeParse(value ?? {});
    if (!result.success) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_FAILED,
        'The request is invalid',
        result.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      );
    }
    return result.data;
  }
}
