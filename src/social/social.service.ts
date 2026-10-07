import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';

/// Pages Facebook des vendeurs : connexion via Facebook Login (OAuth), puis
/// publication d'un produit sur la page du vendeur APRÈS validation admin.
/// Nécessite une application Meta (FB_APP_ID, FB_APP_SECRET) avec les
/// permissions pages_show_list, pages_manage_posts, pages_read_engagement
/// approuvées par Meta pour les comptes autres que les testeurs de l'app.
/// TikTok : l'API de publication exige un audit TikTok et un domaine vérifié,
/// prévu quand Karataka aura son nom de domaine.
const SCOPES = 'pages_show_list,pages_manage_posts,pages_read_engagement';

@Injectable()
export class SocialService {
  private readonly log = new Logger(SocialService.name);
  /// Pages proposées après connexion, le temps que le vendeur choisisse.
  private pendingPages = new Map<string, { userId: string; pages: { id: string; name: string; access_token: string }[]; until: number }>();

  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
    private settings: SettingsService,
  ) {}

  private get graph() {
    return `https://graph.facebook.com/${process.env.FB_GRAPH_VERSION || 'v21.0'}`;
  }

  get facebookEnabled() {
    return !!(this.settings.get('FB_APP_ID') && this.settings.get('FB_APP_SECRET'));
  }

  private secret() {
    return process.env.JWT_SECRET || 'dev_secret';
  }

  private async fbGet(path: string, params: Record<string, string>) {
    const url = `${this.graph}/${path}?${new URLSearchParams(params)}`;
    const res = await fetch(url);
    const body: any = await res.json().catch(() => ({}));
    if (!res.ok || body.error) throw new Error(body?.error?.message ?? `HTTP ${res.status}`);
    return body;
  }

  // ——— Connexion ———

  connectUrl(userId: string, apiBase: string) {
    if (!this.facebookEnabled) throw new ServiceUnavailableException("La connexion Facebook n'est pas encore activée par Karataka");
    const state = jwt.sign({ sub: userId, kind: 'fb-connect' }, this.secret(), { expiresIn: '15m' });
    const params = new URLSearchParams({
      client_id: this.settings.get('FB_APP_ID'),
      redirect_uri: `${apiBase}/social/facebook/callback`,
      state,
      scope: SCOPES,
      response_type: 'code',
    });
    return { url: `https://www.facebook.com/${process.env.FB_GRAPH_VERSION || 'v21.0'}/dialog/oauth?${params}` };
  }

  /// Retour de Facebook : échange le code, récupère les pages gérées.
  async callback(code: string, state: string, apiBase: string) {
    let userId: string;
    try {
      const payload = jwt.verify(state, this.secret()) as { sub: string; kind: string };
      if (payload.kind !== 'fb-connect') throw new Error('bad state');
      userId = payload.sub;
    } catch {
      return { done: false, message: 'Lien expiré : recommencez la connexion depuis l’application.' };
    }
    try {
      const short = await this.fbGet('oauth/access_token', {
        client_id: this.settings.get('FB_APP_ID'),
        client_secret: this.settings.get('FB_APP_SECRET'),
        redirect_uri: `${apiBase}/social/facebook/callback`,
        code,
      });
      const long = await this.fbGet('oauth/access_token', {
        grant_type: 'fb_exchange_token',
        client_id: this.settings.get('FB_APP_ID'),
        client_secret: this.settings.get('FB_APP_SECRET'),
        fb_exchange_token: short.access_token,
      });
      const accounts = await this.fbGet('me/accounts', { fields: 'id,name,access_token', access_token: long.access_token });
      const pages = (accounts.data ?? []) as { id: string; name: string; access_token: string }[];
      if (!pages.length) return { done: false, message: 'Aucune page Facebook trouvée. Créez une page pour votre boutique, puis recommencez.' };
      if (pages.length === 1) {
        await this.savePage(userId, pages[0]);
        return { done: true, message: `Page « ${pages[0].name} » connectée à votre boutique Karataka.` };
      }
      const key = Math.random().toString(36).slice(2) + Date.now().toString(36);
      this.pendingPages.set(key, { userId, pages, until: Date.now() + 15 * 60_000 });
      return { done: false, choose: { key, pages: pages.map((p) => ({ id: p.id, name: p.name })) } };
    } catch (error) {
      this.log.warn(`facebook callback: ${(error as Error).message}`);
      return { done: false, message: 'Facebook a refusé la connexion. Réessayez.' };
    }
  }

  async choosePage(key: string, pageId: string) {
    const pending = this.pendingPages.get(key);
    if (!pending || pending.until < Date.now()) return { done: false, message: 'Lien expiré : recommencez depuis l’application.' };
    const page = pending.pages.find((p) => p.id === pageId);
    if (!page) return { done: false, message: 'Page introuvable.' };
    this.pendingPages.delete(key);
    await this.savePage(pending.userId, page);
    return { done: true, message: `Page « ${page.name} » connectée à votre boutique Karataka.` };
  }

  private savePage(userId: string, page: { id: string; name: string; access_token: string }) {
    return this.prisma.socialAccount.upsert({
      where: { userId_platform: { userId, platform: 'facebook' } },
      create: { userId, platform: 'facebook', pageId: page.id, pageName: page.name, accessToken: page.access_token },
      update: { pageId: page.id, pageName: page.name, accessToken: page.access_token },
    });
  }

  async accounts(userId: string) {
    const rows = await this.prisma.socialAccount.findMany({ where: { userId }, select: { platform: true, pageId: true, pageName: true, createdAt: true } });
    return { facebookEnabled: this.facebookEnabled, tiktokEnabled: false, accounts: rows };
  }

  async disconnect(userId: string, platform: string) {
    await this.prisma.socialAccount.deleteMany({ where: { userId, platform } });
    return { ok: true };
  }

  // ——— Publications ———

  async requestPost(userId: string, body: { productId?: string; platform?: string; message?: string }) {
    const platform = body.platform === 'tiktok' ? 'tiktok' : 'facebook';
    if (platform === 'tiktok') throw new BadRequestException('La publication TikTok arrive bientôt');
    const account = await this.prisma.socialAccount.findUnique({ where: { userId_platform: { userId, platform } } });
    if (!account) throw new BadRequestException("Connectez d'abord votre page Facebook");
    const product = await this.prisma.product.findUnique({ where: { id: String(body.productId ?? '') } });
    if (!product || product.sellerId !== userId) throw new ForbiddenException('Vous ne pouvez publier que vos propres produits');
    const message = String(body.message ?? '').trim().slice(0, 2000);
    if (message.length < 10) throw new BadRequestException('Écrivez un texte pour la publication (10 caractères minimum)');
    const pending = await this.prisma.socialPost.count({ where: { sellerId: userId, status: 'pending' } });
    if (pending >= 5) throw new BadRequestException('Vous avez déjà 5 publications en attente de validation');
    const post = await this.prisma.socialPost.create({ data: { sellerId: userId, productId: product.id, platform, message } });
    await this.notifications.notifyAdmins({
      type: 'seller',
      title: 'Publication Facebook à valider',
      body: `« ${product.name} » sur la page ${account.pageName}`,
      data: { screen: 'admin-social', postId: post.id },
    });
    return post;
  }

  private async withProducts<T extends { productId: string }>(posts: T[]) {
    const products = await this.prisma.product.findMany({
      where: { id: { in: posts.map((p) => p.productId) } },
      select: { id: true, name: true, imageUrl: true, price: true },
    });
    return posts.map((p) => ({ ...p, product: products.find((x) => x.id === p.productId) ?? null }));
  }

  async myPosts(userId: string) {
    const posts = await this.prisma.socialPost.findMany({ where: { sellerId: userId }, orderBy: { createdAt: 'desc' }, take: 50 });
    return this.withProducts(posts);
  }

  async adminList(status?: string) {
    const posts = await this.prisma.socialPost.findMany({
      where: status ? { status } : undefined,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    const sellers = await this.prisma.user.findMany({
      where: { id: { in: posts.map((p) => p.sellerId) } },
      select: { id: true, username: true, displayName: true },
    });
    const accounts = await this.prisma.socialAccount.findMany({
      where: { userId: { in: posts.map((p) => p.sellerId) } },
      select: { userId: true, platform: true, pageName: true },
    });
    return (await this.withProducts(posts)).map((p) => ({
      ...p,
      seller: sellers.find((s) => s.id === p.sellerId) ?? null,
      pageName: accounts.find((a) => a.userId === p.sellerId && a.platform === p.platform)?.pageName ?? null,
    }));
  }

  /// Validation admin : publie la photo du produit avec le texte et le lien
  /// vers la boutique sur la page Facebook du vendeur.
  async approve(id: string, publicBase: string) {
    const post = await this.prisma.socialPost.findUnique({ where: { id } });
    if (!post) throw new NotFoundException('Publication introuvable');
    if (post.status !== 'pending' && post.status !== 'failed') throw new BadRequestException('Publication déjà traitée');
    const account = await this.prisma.socialAccount.findUnique({ where: { userId_platform: { userId: post.sellerId, platform: post.platform } } });
    const product = await this.prisma.product.findUnique({ where: { id: post.productId } });
    if (!account || !product) {
      await this.prisma.socialPost.update({ where: { id }, data: { status: 'failed', error: 'Page ou produit introuvable', reviewedAt: new Date() } });
      throw new BadRequestException('La page du vendeur ou le produit n’existe plus');
    }
    const image = product.imageUrl ? (product.imageUrl.startsWith('/') ? `${publicBase}${product.imageUrl}` : product.imageUrl) : null;
    const caption = `${post.message}\n\n👉 ${publicBase}/p/${product.id}`;
    try {
      const res = await fetch(`${this.graph}/${account.pageId}/${image ? 'photos' : 'feed'}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(image ? { url: image, caption, access_token: account.accessToken } : { message: caption, access_token: account.accessToken }),
      });
      const body: any = await res.json().catch(() => ({}));
      if (!res.ok || body.error) throw new Error(body?.error?.message ?? `HTTP ${res.status}`);
      await this.prisma.socialPost.update({
        where: { id },
        data: { status: 'published', externalId: String(body.post_id ?? body.id ?? ''), error: null, reviewedAt: new Date() },
      });
      await this.notifications.notifyUser(post.sellerId, {
        type: 'seller',
        title: 'Publication Facebook en ligne ✅',
        body: `« ${product.name} » est publié sur ${account.pageName}.`,
        data: { screen: 'seller-social' },
      });
      return { ok: true };
    } catch (error) {
      const message = (error as Error).message.slice(0, 300);
      await this.prisma.socialPost.update({ where: { id }, data: { status: 'failed', error: message, reviewedAt: new Date() } });
      throw new BadRequestException(`Facebook a refusé la publication : ${message}`);
    }
  }

  async reject(id: string, note?: string) {
    const post = await this.prisma.socialPost.findUnique({ where: { id } });
    if (!post) throw new NotFoundException('Publication introuvable');
    await this.prisma.socialPost.update({ where: { id }, data: { status: 'rejected', reviewNote: note?.slice(0, 300) ?? null, reviewedAt: new Date() } });
    await this.notifications.notifyUser(post.sellerId, {
      type: 'seller',
      title: 'Publication Facebook refusée',
      body: note ? `Motif : ${note.slice(0, 150)}` : 'Modifiez le texte et proposez-la à nouveau.',
      data: { screen: 'seller-social' },
    });
    return { ok: true };
  }
}
