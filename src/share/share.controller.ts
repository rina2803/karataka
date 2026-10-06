import { Controller, Get, Header, Param, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { fallbackProductImage } from '../seed-catalog';

const ANDROID_PACKAGE = process.env.ANDROID_PACKAGE || 'com.lalao.karataka.lalao_app';

function esc(value: unknown) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function formatAr(value: unknown) {
  return `${Math.round(Number(value) || 0).toLocaleString('fr-FR').replace(/ | /g, ' ')} Ar`;
}

/// Pages web publiques des liens partagés (Facebook, WhatsApp, TikTok…).
/// Les balises Open Graph donnent l'aperçu (image, titre, prix) ; le bouton
/// ouvre l'app si elle est installée (karataka://…), sinon propose l'APK.
/// Aucune API Meta/TikTok n'est utilisée : simple lien web standard.
@Controller()
export class ShareController {
  constructor(private prisma: PrismaService) {}

  private baseUrl(req: Request) {
    const configured = process.env.PUBLIC_WEB_URL?.replace(/\/+$/, '');
    if (configured) return configured;
    const proto = (req.headers['x-forwarded-proto'] as string)?.split(',')[0] || req.protocol;
    return `${proto}://${req.get('host')}`;
  }

  private async apkUrl() {
    const release = await this.prisma.appRelease.findFirst({ where: { platform: 'android' }, orderBy: { buildNumber: 'desc' } });
    return release?.apkUrl ?? null;
  }

  /// Android App Links : prouve que le domaine appartient à l'app, pour que
  /// les liens https s'ouvrent directement dedans. Nécessite l'empreinte
  /// SHA-256 du certificat de signature dans ANDROID_CERT_SHA256.
  @Get('.well-known/assetlinks.json')
  @Header('Content-Type', 'application/json')
  assetLinks() {
    const fingerprints = (process.env.ANDROID_CERT_SHA256 || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (fingerprints.length === 0) return [];
    return [
      {
        relation: ['delegate_permission/common.handle_all_urls'],
        target: { namespace: 'android_app', package_name: ANDROID_PACKAGE, sha256_cert_fingerprints: fingerprints },
      },
    ];
  }

  @Get('product/:id')
  async product(@Param('id') id: string, @Req() req: Request, @Res() res: Response) {
    const base = this.baseUrl(req);
    const product = await this.prisma.product.findFirst({
      where: { id, active: true },
      include: { seller: { select: { displayName: true, username: true } } },
    });
    if (!product) {
      res.status(404).type('html').send(this.page(base, { title: 'Produit introuvable', description: "Ce produit n'est plus disponible sur Karataka.", path: `product/${esc(id)}`, apk: await this.apkUrl() }));
      return;
    }
    const rawImage = product.imageUrl || fallbackProductImage(product.category);
    const image = rawImage.startsWith('/') ? `${base}${rawImage}` : rawImage;
    const seller = product.seller ? product.seller.displayName || product.seller.username : product.sellerName;
    res.type('html').send(
      this.page(base, {
        title: `${product.name} — ${formatAr(product.price)}`,
        description: (product.description || `Disponible chez ${seller ?? 'Karataka'} sur Karataka.`).slice(0, 200),
        image,
        path: `product/${product.id}`,
        price: formatAr(product.price),
        oldPrice: product.isPromo && product.originalPrice ? formatAr(product.originalPrice) : undefined,
        seller: seller ?? undefined,
        apk: await this.apkUrl(),
      }),
    );
  }

  @Get('shop/:id')
  async shop(@Param('id') id: string, @Req() req: Request, @Res() res: Response) {
    const base = this.baseUrl(req);
    const user = await this.prisma.user.findUnique({ where: { id }, select: { id: true, displayName: true, username: true } });
    const name = user ? user.displayName || user.username : 'Boutique introuvable';
    res.status(user ? 200 : 404).type('html').send(
      this.page(base, {
        title: user ? `Boutique ${name} sur Karataka` : name,
        description: user ? `Découvrez les produits de ${name} sur Karataka. Achetez. Vendez. Jouez. Gagnez.` : "Cette boutique n'existe pas.",
        path: `shop/${esc(id)}`,
        apk: await this.apkUrl(),
      }),
    );
  }

  private page(
    base: string,
    p: { title: string; description: string; path: string; image?: string; price?: string; oldPrice?: string; seller?: string; apk: string | null },
  ) {
    const url = `${base}/${p.path}`;
    const fallback = p.apk ?? url;
    const intent = `intent://${p.path}#Intent;scheme=karataka;package=${ANDROID_PACKAGE};S.browser_fallback_url=${encodeURIComponent(fallback)};end`;
    return `<!doctype html>
<html lang="fr"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(p.title)}</title>
<meta name="description" content="${esc(p.description)}">
<meta property="og:type" content="${p.price ? 'product' : 'website'}">
<meta property="og:site_name" content="Karataka">
<meta property="og:title" content="${esc(p.title)}">
<meta property="og:description" content="${esc(p.description)}">
<meta property="og:url" content="${esc(url)}">
${p.image ? `<meta property="og:image" content="${esc(p.image)}"><meta name="twitter:card" content="summary_large_image">` : ''}
<style>
body{margin:0;font-family:system-ui,-apple-system,Roboto,sans-serif;background:#F8FBFE;color:#16283A}
.w{max-width:480px;margin:0 auto;padding:16px}
.c{background:#fff;border-radius:20px;overflow:hidden;box-shadow:0 6px 24px rgba(31,101,228,.08)}
img{width:100%;aspect-ratio:1;object-fit:cover;display:block}
.b{padding:16px}h1{font-size:20px;margin:0 0 6px}
.p{font-size:22px;font-weight:800;color:#1F65E4}.o{color:#8A99A8;text-decoration:line-through;margin-left:8px;font-size:15px}
.s{color:#5B6B7B;font-size:14px;margin:6px 0 12px}.d{font-size:15px;line-height:1.45;color:#33475B}
a.btn{display:block;text-align:center;padding:14px;border-radius:14px;font-weight:700;text-decoration:none;margin-top:12px}
.pr{background:#1F65E4;color:#fff}.sc{background:#E8F1FF;color:#1F65E4}
.t{text-align:center;color:#8A99A8;font-size:13px;margin-top:18px}
</style></head><body><div class="w"><div class="c">
${p.image ? `<img src="${esc(p.image)}" alt="${esc(p.title)}">` : ''}
<div class="b"><h1>${esc(p.title)}</h1>
${p.price ? `<div><span class="p">${esc(p.price)}</span>${p.oldPrice ? `<span class="o">${esc(p.oldPrice)}</span>` : ''}</div>` : ''}
${p.seller ? `<div class="s">Vendu par ${esc(p.seller)}</div>` : ''}
<div class="d">${esc(p.description)}</div>
<a class="btn pr" href="${esc(intent)}">Ouvrir dans Karataka</a>
${p.apk ? `<a class="btn sc" href="${esc(p.apk)}">Télécharger l'application</a>` : ''}
</div></div><div class="t">🛍️ Karataka — Achetez. Vendez. Jouez. Gagnez.</div></div></body></html>`;
  }
}
