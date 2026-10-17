import { Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';

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
  private render(res: Response, key: PageKey, token: unknown): void {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    );
    res.type('html');
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
    res
      .status(200)
      .send(
        page(
          title,
          `<p>${intro}</p><a class="button" href="${deepLink}">Open GameVerse</a><p>If nothing happens, make sure GameVerse is installed on this phone, then tap the button again.</p>`,
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
}
