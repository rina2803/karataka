import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Observable } from 'rxjs';
import { ActivityService } from './activity.service';

/// [méthode, chemin (les identifiants sont remplacés par « : »), action, texte].
const ROUTES: [string, RegExp, string, string][] = [
  ['GET', /^\/users\/me$/, 'app_open', 'Ouverture de l’app'],
  ['PATCH', /^\/users\/me$/, 'profile', 'Profil modifié'],
  ['POST', /^\/cart\/checkout$/, 'order', 'Commande passée'],
  ['POST', /^\/cart\/orders\/:\/review$/, 'review', 'Note donnée à un vendeur'],
  ['POST', /^\/fair\/cart\/checkout$/, 'order', 'Commande Foire passée'],
  ['POST', /^\/marketplace\/buy$/, 'order', 'Achat immédiat'],
  ['POST', /^\/marketplace\/products$/, 'product', 'Annonce publiée'],
  ['PATCH', /^\/marketplace\/products\/:$/, 'product', 'Annonce modifiée'],
  ['PUT', /^\/marketplace\/products\/:$/, 'product', 'Annonce modifiée'],
  ['DELETE', /^\/marketplace\/products\/:$/, 'product', 'Annonce retirée'],
  ['POST', /^\/marketplace\/products\/:\/promo$/, 'product', 'Promo créée'],
  ['DELETE', /^\/marketplace\/products\/:\/promo$/, 'product', 'Promo retirée'],
  ['POST', /^\/marketplace\/products\/:\/share$/, 'share', 'Produit partagé'],
  ['POST', /^\/payments\/(manual|mvola)\/deposit$/, 'payment', 'Demande de dépôt'],
  ['POST', /^\/payments\/(manual|mvola)\/withdraw$/, 'payment', 'Demande de retrait'],
  ['POST', /^\/seller\/apply$/, 'seller', 'Demande pour devenir vendeur'],
  ['POST', /^\/sellers\/:\/follow$/, 'follow', 'Abonnement à un vendeur'],
  ['DELETE', /^\/sellers\/:\/follow$/, 'follow', 'Désabonnement d’un vendeur'],
  ['POST', /^\/points\/spin$/, 'game', 'Roue du jour'],
  ['POST', /^\/games\/tournaments$/, 'game', 'Tournoi créé'],
  ['POST', /^\/games\/tournaments\/:\/join$/, 'game', 'Inscription à un tournoi'],
  ['POST', /^\/auctions\/:\/bid$/, 'auction', 'Enchère placée'],
  ['POST', /^\/social\/posts$/, 'social', 'Publication Facebook proposée'],
  ['POST', /^\/ai\//, 'ai', 'Utilisation de l’IA'],
  ['POST', /^\/wallet\/deposit\/:$/, 'payment', 'Dépôt sur le portefeuille'],
  ['POST', /^\/wallet\/withdraw\/:$/, 'payment', 'Retrait du portefeuille'],
  ['POST', /^\/admin\/payment-requests\/:\/approve$/, 'admin', 'Admin : dépôt/retrait validé'],
  ['POST', /^\/admin\/payment-requests\/:\/reject$/, 'admin', 'Admin : dépôt/retrait refusé'],
  ['POST', /^\/admin\/seller-applications\/:\/approve$/, 'admin', 'Admin : vendeur validé'],
  ['POST', /^\/admin\/seller-applications\/:\/reject$/, 'admin', 'Admin : vendeur refusé'],
  ['POST', /^\/admin\/products$/, 'admin', 'Admin : produit ajouté'],
  ['PUT', /^\/admin\/products\/:$/, 'admin', 'Admin : produit modifié'],
  ['DELETE', /^\/admin\/products\/:$/, 'admin', 'Admin : produit archivé'],
  ['POST', /^\/admin\/app-releases$/, 'admin', 'Admin : nouvelle version de l’app publiée'],
  ['POST', /^\/admin\/cart-orders\/:\/approve$/, 'admin', 'Admin : commande validée'],
  ['POST', /^\/admin\/cart-orders\/:\/deliver$/, 'admin', 'Admin : commande livrée'],
  ['POST', /^\/admin\/cart-orders\/:\/reject$/, 'admin', 'Admin : commande refusée'],
  ['PATCH', /^\/admin\/cart-orders\/:$/, 'admin', 'Admin : montants d’une commande modifiés'],
  ['PATCH', /^\/admin\/users\/:$/, 'admin', 'Admin : compte modifié'],
  ['DELETE', /^\/admin\/users\/:$/, 'admin', 'Admin : compte supprimé'],
  ['PUT', /^\/admin\/settings\/[A-Z_]+$/, 'admin', 'Admin : réglage modifié'],
];

/// Routes jamais journalisées ici (bruit, ou déjà tracées ailleurs).
const IGNORED = [/^\/notifications\//, /^\/auth\//, /^\/admin\/users\/:\/impersonate$/];

/// Un identifiant (cuid, uuid, nombre) dans le chemin devient « : ».
function normalize(path: string) {
  return path
    .split('?')[0]
    .replace(/\/+$/, '')
    .split('/')
    .map((part) => (/^(c[a-z0-9]{20,}|[0-9a-f-]{32,36}|\d+)$/i.test(part) ? ':' : part))
    .join('/');
}

export function clientIp(req: Request) {
  const forwarded = req.headers['x-forwarded-for'];
  const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim();
  return first || req.socket?.remoteAddress || null;
}

/// Appareil lisible : en-tête envoyé par l'app, sinon le navigateur.
export function deviceLabel(req: Request) {
  const app = req.headers['x-app-client'];
  if (typeof app === 'string' && app) return app;
  const ua = req.headers['user-agent'] ?? '';
  if (/dart/i.test(ua)) return 'App Android';
  if (/iPhone|iPad/i.test(ua)) return 'iPhone (web)';
  if (/Android/i.test(ua)) return 'Android (web)';
  return ua ? 'Navigateur' : null;
}

/// Journalise les actions des utilisateurs connectés (après la réponse,
/// avec son code) et met à jour leur dernière activité.
@Injectable()
export class ActivityInterceptor implements NestInterceptor {
  constructor(private activity: ActivityService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const req = context.switchToHttp().getRequest<Request & { user?: { sub: string; imp?: string } }>();
    const res = context.switchToHttp().getResponse<Response>();
    const userId = req.user?.sub;
    if (!userId) return next.handle();

    this.activity.touch(userId);
    const path = normalize(req.originalUrl || req.url);
    if (IGNORED.some((re) => re.test(path))) return next.handle();
    const route = ROUTES.find(([method, re]) => method === req.method && re.test(path));
    if (!route && req.method === 'GET') return next.handle();
    if (route?.[2] === 'app_open' && !this.activity.shouldLogOpen(userId)) return next.handle();

    const action = route?.[2] ?? 'other';
    const label = route?.[3] ?? `${req.method} ${path}`;
    res.once('finish', () => {
      this.activity.record({
        userId,
        action,
        label: res.statusCode >= 400 ? `${label} (échec ${res.statusCode})` : label,
        method: req.method,
        path,
        status: res.statusCode,
        ip: clientIp(req),
        device: deviceLabel(req),
        byAdmin: req.user?.imp ?? null,
      });
    });
    return next.handle();
  }
}
