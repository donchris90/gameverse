import { Body, Controller, Get, HttpException, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { AccountService } from '../users/account.service.js';

/** One-time tokens are 32 random bytes, base64url encoded. Anything else is refused outright. */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{20,512}$/;

const PAGES = {
  'verify-email': {
    title: 'Verify your email',
    intro: 'Open GameVerse on this phone to finish verifying your email address.',
  },
  'reset-password': {
    title: 'Reset your password',
    intro: 'Open GameVerse on this phone to choose a new password.',
  },
  'delete-account': {
    title: 'Confirm account deletion',
    intro:
      'Open GameVerse on this phone, signed in to the account you want to delete, to confirm. Deleting your account cannot be undone.',
  },
} as const;
type PageKey = keyof typeof PAGES;

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<meta name="referrer" content="no-referrer">
<title>${title} · GameVerse</title>
<style>
body{margin:0;background:#0B0C24;color:#F5F5FF;font:16px/1.5 system-ui,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:24px;box-sizing:border-box}
main{max-width:420px}h1{font-size:26px;margin:0 0 12px}p{color:#C3C6EE}
button,input[type=email]{font:inherit;width:100%;box-sizing:border-box;padding:14px 20px;border-radius:8px;border:1px solid #3A3D7A;margin:8px 0}input[type=email]{background:#14163A;color:#F5F5FF}button{background:#6A47F5;color:#fff;font-weight:600;border:0;cursor:pointer}button.danger{background:#C8352F}hr{border:0;border-top:1px solid #3A3D7A;margin:24px 0}
a.button{display:block;text-align:center;background:#6A47F5;color:#fff;text-decoration:none;font-weight:600;padding:14px 20px;border-radius:8px;margin:24px 0 8px}
</style>
</head>
<body><main><h1>${title}</h1>${body}</main></body>
</html>`;
}

/**
 * Landing pages for the links in our emails. Mail clients only make https links clickable, so the
 * emails point here and this page hands the one-time token to the app through its custom scheme.
 * The token is validated against a strict pattern before it is placed in the page, so nothing from
 * the query string can inject markup. Replace with universal / app links once a domain is set up.
 */
@Controller()
export class WebLinksController {
  constructor(private readonly account: AccountService) {}

  private secure(res: Response): void {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    );
    res.type('html');
  }

  private render(res: Response, key: PageKey, token: unknown): void {
    this.secure(res);
    const { title, intro } = PAGES[key];
    if (typeof token !== 'string' || !TOKEN_PATTERN.test(token)) {
      res
        .status(400)
        .send(
          page(
            'This link is not valid',
            '<p>The link is incomplete or damaged. Request a new email from the GameVerse app.</p>',
          ),
        );
      return;
    }
    const deepLink = `gameverse://${key}?token=${token}`;
    const webForm =
      key === 'delete-account'
        ? `<hr><p>No app on this device? You can delete the account right here. This cannot be undone.</p><form method="post" action="/delete-account"><input type="hidden" name="token" value="${token}"><button class="danger" type="submit">Delete my account</button></form>`
        : '';
    res
      .status(200)
      .send(
        page(
          title,
          `<p>${intro}</p><a class="button" href="${deepLink}">Open GameVerse</a><p>If nothing happens, make sure GameVerse is installed on this phone, then tap the button again.</p>${webForm}`,
        ),
      );
  }

  @Get('verify-email')
  verifyEmail(@Query('token') token: unknown, @Res() res: Response): void {
    this.render(res, 'verify-email', token);
  }

  @Get('reset-password')
  resetPassword(@Query('token') token: unknown, @Res() res: Response): void {
    this.render(res, 'reset-password', token);
  }

  @Get('delete-account')
  deleteAccount(@Query('token') token: unknown, @Res() res: Response): void {
    this.render(res, 'delete-account', token);
  }

  /** Public page for asking to delete an account without the app (store requirement). */
  @Get('account-deletion')
  deletionRequestPage(@Res() res: Response): void {
    this.secure(res);
    res
      .status(200)
      .send(
        page(
          'Delete your GameVerse account',
          `<p>Enter the email address of your GameVerse account. If an account exists we will email you a link to confirm. Deleting removes your profile, friends, chats and sign-in details. Reports and moderation records are kept for the safety of other players, as described in our privacy policy.</p><form method="post" action="/account-deletion"><input type="email" name="email" placeholder="you@example.com" autocomplete="email" required maxlength="254"><button type="submit">Email me the link</button></form>`,
        ),
      );
  }

  @Post('account-deletion')
  async requestDeletion(@Body() body: unknown, @Res() res: Response): Promise<void> {
    this.secure(res);
    const parsed = z.object({ email: z.email().max(254) }).safeParse(body);
    if (parsed.success) await this.account.requestDeletionByEmail(parsed.data.email);
    // Same answer for valid and invalid addresses and for addresses with no account.
    res
      .status(200)
      .send(
        page(
          'Check your email',
          '<p>If that address belongs to a GameVerse account, we have sent a link to confirm the deletion. The link works for one hour.</p>',
        ),
      );
  }

  @Post('delete-account')
  async confirmDeletion(@Body() body: unknown, @Res() res: Response): Promise<void> {
    this.secure(res);
    const token = (body as { token?: unknown } | undefined)?.token;
    if (typeof token !== 'string' || !TOKEN_PATTERN.test(token)) {
      res
        .status(400)
        .send(
          page(
            'This link is not valid',
            '<p>Request a new link from the account deletion page.</p>',
          ),
        );
      return;
    }
    try {
      await this.account.confirmDeletionByToken(token);
    } catch (error) {
      if (error instanceof HttpException) {
        res
          .status(error.getStatus())
          .send(
            page(
              'Could not delete the account',
              `<p>${error.getStatus() === 409 ? 'This account cannot be deleted right now. Contact support.' : 'This link is invalid or has expired. Request a new one.'}</p>`,
            ),
          );
        return;
      }
      throw error;
    }
    res
      .status(200)
      .send(
        page(
          'Account deleted',
          '<p>Your GameVerse account and personal data have been deleted.</p>',
        ),
      );
  }
}
