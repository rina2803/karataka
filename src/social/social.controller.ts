import { Body, Controller, Delete, Get, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AdminGuard } from '../auth/admin.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SettingsService } from '../settings/settings.service';
import { SocialService } from './social.service';

function esc(value: unknown) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function apiBase(req: Request) {
  const proto = (req.headers['x-forwarded-proto'] as string)?.split(',')[0] || req.protocol;
  return `${proto}://${req.get('host')}`;
}

/// Page affichée dans le navigateur à la fin de la connexion Facebook.
function resultPage(title: string, body: string) {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><style>body{font-family:system-ui,Roboto,sans-serif;background:#F8FBFE;color:#102450;margin:0}
.w{max-width:440px;margin:0 auto;padding:32px 16px;text-align:center}.c{background:#fff;border-radius:20px;padding:22px;box-shadow:0 6px 24px rgba(31,79,224,.08)}
a.b{display:block;padding:14px;border-radius:14px;background:#1F4FE0;color:#fff;text-decoration:none;font-weight:800;margin-top:12px}</style></head>
<body><div class="w"><div class="c"><h2>${esc(title)}</h2>${body}<a class="b" href="karataka://seller-social">Revenir dans Karataka</a></div></div></body></html>`;
}

@Controller()
export class SocialController {
  constructor(private social: SocialService, private settings: SettingsService) {}

  private publicBase(req: Request) {
    return this.settings.get('PUBLIC_WEB_URL').replace(/\/+$/, '') || apiBase(req);
  }

  @UseGuards(JwtAuthGuard)
  @Get('social/accounts')
  accounts(@Req() req: any) {
    return this.social.accounts(req.user.sub);
  }

  @UseGuards(JwtAuthGuard)
  @Get('social/facebook/connect-url')
  connectUrl(@Req() req: any) {
    return this.social.connectUrl(req.user.sub, apiBase(req));
  }

  @Get('social/facebook/callback')
  async callback(@Query('code') code: string, @Query('state') state: string, @Query('error') error: string, @Req() req: Request, @Res() res: Response) {
    if (error || !code) {
      res.type('html').send(resultPage('Connexion annulée', '<p>Vous pourrez relier votre page plus tard depuis l’espace vendeur.</p>'));
      return;
    }
    const result = await this.social.callback(code, state, apiBase(req));
    if (result.choose) {
      const links = result.choose.pages
        .map((p) => `<a class="b" href="/social/facebook/choose?k=${encodeURIComponent(result.choose!.key)}&page=${encodeURIComponent(p.id)}">${esc(p.name)}</a>`)
        .join('');
      res.type('html').send(resultPage('Quelle page relier ?', `<p>Choisissez la page de votre boutique :</p>${links}`));
      return;
    }
    res.type('html').send(resultPage(result.done ? 'Page connectée ✅' : 'Connexion impossible', `<p>${esc(result.message)}</p>`));
  }

  @Get('social/facebook/choose')
  async choose(@Query('k') key: string, @Query('page') page: string, @Res() res: Response) {
    const result = await this.social.choosePage(key, page);
    res.type('html').send(resultPage(result.done ? 'Page connectée ✅' : 'Connexion impossible', `<p>${esc(result.message)}</p>`));
  }

  @UseGuards(JwtAuthGuard)
  @Delete('social/accounts/:platform')
  disconnect(@Req() req: any, @Param('platform') platform: string) {
    return this.social.disconnect(req.user.sub, platform);
  }

  @UseGuards(JwtAuthGuard)
  @Post('social/posts')
  request(@Req() req: any, @Body() body: { productId?: string; platform?: string; message?: string }) {
    return this.social.requestPost(req.user.sub, body ?? {});
  }

  @UseGuards(JwtAuthGuard)
  @Get('social/posts/mine')
  mine(@Req() req: any) {
    return this.social.myPosts(req.user.sub);
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Get('admin/social-posts')
  adminList(@Query('status') status?: string) {
    return this.social.adminList(status || undefined);
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Post('admin/social-posts/:id/approve')
  approve(@Param('id') id: string, @Req() req: Request) {
    return this.social.approve(id, this.publicBase(req));
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Post('admin/social-posts/:id/reject')
  reject(@Param('id') id: string, @Body() body: { note?: string }) {
    return this.social.reject(id, body?.note);
  }
}
