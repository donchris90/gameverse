import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { registerDeviceSchema, unregisterDeviceQuerySchema } from '@gameverse/shared-types';
import type { z } from 'zod';
import type { AuthUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { PushService } from './push.service.js';

@Controller('me/devices')
@UseGuards(JwtAuthGuard)
export class PushController {
  constructor(private readonly push: PushService) {}

  @Put()
  @HttpCode(HttpStatus.NO_CONTENT)
  register(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(registerDeviceSchema)) body: z.output<typeof registerDeviceSchema>,
  ): Promise<void> {
    return this.push.registerDevice(user.id, body.token, body.platform);
  }

  /** Call on logout so the next person using this phone does not receive your notifications. */
  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  unregister(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(unregisterDeviceQuerySchema))
    query: z.output<typeof unregisterDeviceQuerySchema>,
  ): Promise<void> {
    return this.push.unregisterDevice(user.id, query.token);
  }
}
