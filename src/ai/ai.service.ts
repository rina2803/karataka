import { BadRequestException, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { GeminiService } from './gemini.service';

/// Limites quotidiennes par compte (maîtrise du coût de l'IA).
const DAILY_LIMITS = { text: 30, image: 6, assistant: 40 } as const;
type Kind = keyof typeof DAILY_LIMITS;

function parseImage(raw?: string) {
  if (!raw) return undefined;
  const match = /^data:(image\/[a-z+]+);base64,(.*)$/s.exec(raw.trim());
  const data = (match ? match[2] : raw).replace(/\s+/g, '');
  if (data.length < 100 || data.length > 8_000_000) throw new BadRequestException('Photo invalide ou trop lourde');
  return { mimeType: match ? match[1] : 'image/jpeg', data };
}

const clean = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max);

@Injectable()
export class AiService {
  private usage = new Map<string, number>();

  constructor(private gemini: GeminiService, private prisma: PrismaService) {}

  private async consume(userId: string, kind: Kind) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
    const limit = DAILY_LIMITS[kind] * (user?.role === 'admin' ? 10 : 1);
    const key = `${userId}:${kind}:${new Date().toISOString().slice(0, 10)}`;
    const used = this.usage.get(key) ?? 0;
    if (used >= limit) {
      throw new HttpException(`Limite du jour atteinte (${limit}). Revenez demain !`, HttpStatus.TOO_MANY_REQUESTS);
    }
    this.usage.set(key, used + 1);
    if (this.usage.size > 50_000) this.usage.clear();
  }

  status() {
    return { enabled: this.gemini.enabled, limits: DAILY_LIMITS };
  }

  /// Titre accrocheur, description et hashtags d'une annonce, à partir du
  /// nom, de la catégorie, de notes du vendeur et éventuellement d'une photo.
  async productDescription(
    userId: string,
    body: { name?: string; category?: string; price?: number; notes?: string; imageBase64?: string },
  ) {
    const name = clean(body.name, 120);
    if (!name && !body.imageBase64) throw new BadRequestException('Indiquez au moins le nom du produit ou une photo');
    await this.consume(userId, 'text');
    const prompt = `Tu es le rédacteur de la boutique en ligne Karataka (Madagascar).
Rédige une annonce de vente attrayante, honnête et en français simple, pour des clients malgaches.
N'invente aucune caractéristique technique précise qui n'est ni dans les notes ni visible sur la photo.
Produit : ${name || '(voir la photo)'}
Catégorie : ${clean(body.category, 60) || 'non précisée'}
Prix : ${body.price ? `${Math.round(Number(body.price))} Ar` : 'non précisé'}
Notes du vendeur : ${clean(body.notes, 500) || 'aucune'}
Réponds en JSON : {"title": "titre court (max 60 caractères)", "description": "3 à 5 phrases, avec 2 ou 3 emojis adaptés", "hashtags": ["5 hashtags sans #"]}`;
    const out = await this.gemini.json<{ title?: string; description?: string; hashtags?: string[] }>(
      prompt,
      parseImage(body.imageBase64),
    );
    return {
      title: clean(out.title, 80),
      description: clean(out.description, 1200),
      hashtags: (Array.isArray(out.hashtags) ? out.hashtags : []).map((h) => clean(h, 30).replace(/^#/, '')).filter(Boolean).slice(0, 6),
    };
  }

  /// Photo produit par l'IA : à partir d'une description, ou en embellissant
  /// la photo du vendeur (fond studio, lumière), sans changer le produit.
  async productImage(userId: string, body: { name?: string; prompt?: string; style?: string; imageBase64?: string }) {
    const name = clean(body.name, 120);
    const extra = clean(body.prompt, 400);
    if (!name && !extra) throw new BadRequestException('Décrivez le produit à mettre en image');
    const photo = parseImage(body.imageBase64);
    await this.consume(userId, 'image');
    const style =
      ({
        studio: 'fond blanc studio, éclairage doux et professionnel, ombre légère',
        lifestyle: 'mise en scène réaliste dans un intérieur moderne et lumineux',
        madagascar: 'mise en scène chaleureuse inspirée de Madagascar (couleurs vives, matières naturelles)',
      } as Record<string, string>)[body.style ?? 'studio'] ?? 'fond blanc studio, éclairage professionnel';
    const prompt = photo
      ? `Retouche cette photo de produit pour une boutique en ligne : garde exactement le même produit (forme, couleurs, logo, détails), ` +
        `supprime le décor encombrant et place-le en ${style}. Format carré, net, sans texte ajouté. ${extra}`
      : `Photo publicitaire carrée et réaliste d'un produit à vendre : ${name}. ${extra}. Style : ${style}. ` +
        `Aucun texte ni logo inventé dans l'image.`;
    const image = await this.gemini.image(prompt, photo);
    return { mimeType: image.mimeType, image: image.data, generated: true };
  }

  /// Assistant Karataka : répond au client et propose des produits réels du
  /// catalogue (jamais inventés : les identifiants sont vérifiés).
  async assistant(userId: string, body: { message?: string; history?: { role: string; text: string }[] }) {
    const message = clean(body.message, 600);
    if (!message) throw new BadRequestException('Posez votre question');
    await this.consume(userId, 'assistant');
    const catalog = await this.prisma.product.findMany({
      where: { active: true, stock: { gt: 0 } },
      orderBy: { createdAt: 'desc' },
      take: 120,
      select: { id: true, name: true, price: true, category: true, isPromo: true },
    });
    const history = (Array.isArray(body.history) ? body.history : [])
      .slice(-6)
      .map((h) => `${h.role === 'user' ? 'Client' : 'Assistant'} : ${clean(h.text, 400)}`)
      .join('\n');
    const prompt = `Tu es « Karataka », l'assistant shopping et jeux de l'application Karataka (Madagascar).
Tu parles français (ou malgache si le client écrit en malgache), de façon chaleureuse, courte et utile.
L'app propose : une boutique (paiement MVola, portefeuille ou à la livraison), des jeux en ligne (échecs, belote, dames, fanorona, ludo, domino, puissance 4, morpion, quiz), des Karataka Points et une page Emplois.
Ne propose QUE des produits de ce catalogue (prix en Ariary), jamais d'autres :
${catalog.map((p) => `${p.id} | ${p.name} | ${Math.round(Number(p.price))} Ar | ${p.category ?? ''}${p.isPromo ? ' | PROMO' : ''}`).join('\n')}

${history ? `Conversation précédente :\n${history}\n` : ''}Client : ${message}

Réponds en JSON : {"reply": "ta réponse (max 5 phrases)", "productIds": ["jusqu'à 6 identifiants du catalogue pertinents, ou liste vide"]}`;
    const out = await this.gemini.json<{ reply?: string; productIds?: string[] }>(prompt);
    const ids = (Array.isArray(out.productIds) ? out.productIds : []).map(String).filter((id) => catalog.some((p) => p.id === id)).slice(0, 6);
    const products = ids.length
      ? await this.prisma.product.findMany({ where: { id: { in: ids } } })
      : [];
    return { reply: clean(out.reply, 1500) || 'Je n’ai pas bien compris, pouvez-vous reformuler ?', products };
  }

  /// Texte d'une publication réseaux sociaux pour un produit.
  async socialCaption(userId: string, productId: string, platform: string) {
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product) throw new BadRequestException('Produit introuvable');
    await this.consume(userId, 'text');
    const out = await this.gemini.json<{ caption?: string }>(
      `Écris une publication ${platform === 'tiktok' ? 'TikTok' : 'Facebook'} en français pour vendre ce produit à Madagascar.
Produit : ${product.name} — ${Math.round(Number(product.price))} Ar${product.isPromo ? ' (en promotion)' : ''}.
Description : ${clean(product.description, 500) || 'aucune'}.
Ton dynamique, 2 à 4 phrases, quelques emojis, termine par un appel à commander sur l'application Karataka et 4 hashtags.
Réponds en JSON : {"caption": "..."}`,
    );
    return { caption: clean(out.caption, 2000) };
  }
}
