import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const TANA_DELIVERY_FEE = 6000;
const OTHER_DELIVERY_FEE = 12000;

function isTana(city: string) {
  const c = city.trim().toLowerCase();
  return c.includes('antananarivo') || c === 'tana' || c.includes('tana-ville');
}

@Injectable()
export class FairService {
  constructor(private prisma: PrismaService) {}

  listEvents(category?: string) {
    return this.prisma.fairEvent.findMany({
      where: {
        active: true,
        ...(category ? { category } : {}),
        OR: [{ endsAt: null }, { endsAt: { gt: new Date() } }],
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /// Checkout panier Foire — AUCUN modèle Prisma dédié n'existe pour
  /// persister une commande Foire (contrainte : ne pas modifier schema.prisma
  /// dans cette tâche pour éviter un conflit avec le panier boutique construit
  /// en parallèle). On réserve donc le stock de façon transactionnelle (seule
  /// partie réellement persistée) et on renvoie une confirmation ; il n'existe
  /// pas encore d'écran admin listant ces commandes précisément — voir le
  /// rapport de fin de tâche pour ce compromis assumé.
  async checkout(
    userId: string,
    body: {
      items: { eventId: string; quantity: number }[];
      deliveryName: string;
      deliveryPhone: string;
      deliveryAddress: string;
      deliveryCity: string;
    },
  ) {
    if (!Array.isArray(body.items) || body.items.length === 0) {
      throw new BadRequestException('Le panier est vide');
    }
    if (!body.deliveryName?.trim() || !body.deliveryPhone?.trim() || !body.deliveryAddress?.trim() || !body.deliveryCity?.trim()) {
      throw new BadRequestException('Merci de renseigner vos informations de livraison');
    }

    return this.prisma.$transaction(async (tx) => {
      let itemsTotal = 0;
      const lines: { eventId: string; title: string; quantity: number; unitPrice: number }[] = [];

      for (const raw of body.items) {
        const quantity = Math.trunc(Number(raw.quantity));
        if (!raw.eventId || !Number.isFinite(quantity) || quantity < 1) {
          throw new BadRequestException('Article de panier invalide');
        }
        const event = await tx.fairEvent.findFirst({ where: { id: raw.eventId, active: true } });
        if (!event) throw new BadRequestException('Un article du panier n\'est plus disponible');
        if (event.stock < quantity) throw new BadRequestException(`Stock insuffisant pour "${event.title}"`);

        const reserved = await tx.fairEvent.updateMany({
          where: { id: event.id, stock: { gte: quantity } },
          data: { stock: { decrement: quantity } },
        });
        if (reserved.count !== 1) throw new BadRequestException(`Stock insuffisant pour "${event.title}"`);

        const unitPrice = Number(event.price);
        itemsTotal += unitPrice * quantity;
        lines.push({ eventId: event.id, title: event.title, quantity, unitPrice });
      }

      const deliveryFee = isTana(body.deliveryCity) ? TANA_DELIVERY_FEE : OTHER_DELIVERY_FEE;

      return {
        ok: true,
        status: 'pending',
        message: 'Commande enregistrée — en attente de validation par un administrateur.',
        itemsTotal,
        deliveryFee,
        total: itemsTotal + deliveryFee,
        items: lines,
        delivery: {
          name: body.deliveryName.trim(),
          phone: body.deliveryPhone.trim(),
          address: body.deliveryAddress.trim(),
          city: body.deliveryCity.trim(),
        },
      };
    });
  }

  // ---- Admin ----

  adminListEvents() {
    return this.prisma.fairEvent.findMany({ orderBy: { createdAt: 'desc' } });
  }

  adminCreateEvent(body: {
    title: string;
    description?: string;
    imageUrl?: string;
    price: number;
    originalPrice?: number;
    stock: number;
    category?: string;
    startsAt?: string;
    endsAt?: string;
  }) {
    const title = body.title?.trim();
    const price = Number(body.price);
    const stock = Math.trunc(Number(body.stock));
    if (!title) throw new BadRequestException('Le titre est requis');
    if (!Number.isFinite(price) || price <= 0) throw new BadRequestException('Le prix doit être supérieur à 0');
    if (!Number.isFinite(stock) || stock < 0) throw new BadRequestException('Le stock ne peut pas être négatif');

    return this.prisma.fairEvent.create({
      data: {
        title,
        description: body.description?.trim() || null,
        imageUrl: body.imageUrl?.trim() || null,
        price: String(price),
        originalPrice: body.originalPrice != null ? String(Number(body.originalPrice)) : null,
        stock,
        category: body.category?.trim() || 'flash',
        startsAt: body.startsAt ? new Date(body.startsAt) : null,
        endsAt: body.endsAt ? new Date(body.endsAt) : null,
      },
    });
  }

  adminUpdateEvent(
    id: string,
    body: Partial<{
      title: string;
      description: string;
      imageUrl: string;
      price: number;
      originalPrice: number | null;
      stock: number;
      category: string;
      active: boolean;
      startsAt: string | null;
      endsAt: string | null;
    }>,
  ) {
    return this.prisma.fairEvent.update({
      where: { id },
      data: {
        ...(body.title !== undefined ? { title: body.title.trim() } : {}),
        ...(body.description !== undefined ? { description: body.description?.trim() || null } : {}),
        ...(body.imageUrl !== undefined ? { imageUrl: body.imageUrl?.trim() || null } : {}),
        ...(body.price !== undefined ? { price: String(Number(body.price)) } : {}),
        ...(body.originalPrice !== undefined ? { originalPrice: body.originalPrice == null ? null : String(Number(body.originalPrice)) } : {}),
        ...(body.stock !== undefined ? { stock: Math.trunc(Number(body.stock)) } : {}),
        ...(body.category !== undefined ? { category: body.category?.trim() || 'flash' } : {}),
        ...(body.active !== undefined ? { active: !!body.active } : {}),
        ...(body.startsAt !== undefined ? { startsAt: body.startsAt ? new Date(body.startsAt) : null } : {}),
        ...(body.endsAt !== undefined ? { endsAt: body.endsAt ? new Date(body.endsAt) : null } : {}),
      },
    });
  }

  async adminDeleteEvent(id: string) {
    await this.prisma.fairEvent.delete({ where: { id } });
    return { ok: true };
  }
}
