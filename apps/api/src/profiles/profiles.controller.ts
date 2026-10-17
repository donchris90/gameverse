import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  type ProfileView,
  type SettingsView,
  type UsernameCheckResult,
  updateProfileSchema,
  updateSettingsSchema,
  usernameCheckQuerySchema,
} from '@gameverse/shared-types';
import type { z } from 'zod';
import type { AuthUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import {
  ProfilesService,
  type UpdateProfileBody,
  type UpdateSettingsBody,
} from './profiles.service.js';

@Controller()
@UseGuards(JwtAuthGuard)
export class ProfilesController {
  constructor(private readonly profiles: ProfilesService) {}

  @Get('me/profile')
  getProfile(@CurrentUser() user: AuthUser): Promise<ProfileView> {
    return this.profiles.getProfile(user.id);
  }

  @Put('me/profile')
  @HttpCode(HttpStatus.OK)
  saveProfile(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(updateProfileSchema)) body: UpdateProfileBody,
  ): Promise<ProfileView> {
    return this.profiles.saveProfile(user.id, body);
  }

  @Get('me/settings')
  getSettings(@CurrentUser() user: AuthUser): Promise<SettingsView> {
    return this.profiles.getSettings(user.id);
  }

  @Patch('me/settings')
  updateSettings(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(updateSettingsSchema)) body: UpdateSettingsBody,
  ): Promise<SettingsView> {
    return this.profiles.updateSettings(user.id, body);
  }

  @Get('usernames/check')
  checkUsername(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(usernameCheckQuerySchema))
    query: z.output<typeof usernameCheckQuerySchema>,
  ): Promise<UsernameCheckResult> {
    return this.profiles.checkUsername(user.id, query.username);
  }
}
