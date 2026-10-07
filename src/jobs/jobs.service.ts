import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';

interface JobInput {
  title?: string;
  description?: string;
  contact?: string;
  image?: string;
  active?: boolean;
}

/// Offres d'emploi publiées par l'admin sous forme d'affiche.
@Injectable()
export class JobsService {
  constructor(private prisma: PrismaService, private notifications: NotificationsService) {}

  /// Liste sans les images (servies à part par GET /jobs/:id/image).
  private toPublic(job: { id: string; title: string | null; description: string | null; contact: string | null; active: boolean; createdAt: Date }) {
    return {
      id: job.id,
      title: job.title,
      description: job.description,
      contact: job.contact,
      active: job.active,
      createdAt: job.createdAt,
      imageUrl: `/jobs/${job.id}/image?v=${job.createdAt.getTime()}`,
    };
  }

  private readonly listSelect = {
    id: true, title: true, description: true, contact: true, active: true, createdAt: true,
  } as const;

  async list(includeInactive = false) {
    const jobs = await this.prisma.jobOffer.findMany({
      where: includeInactive ? undefined : { active: true },
      orderBy: { createdAt: 'desc' },
      select: this.listSelect,
      take: 100,
    });
    return jobs.map((j) => this.toPublic(j));
  }

  image(id: string) {
    return this.prisma.jobOffer.findUnique({ where: { id }, select: { mimeType: true, imageData: true } });
  }

  private parseImage(raw: string) {
    const match = /^data:(image\/[a-z+]+);base64,(.*)$/s.exec(raw.trim());
    const mimeType = match ? match[1] : 'image/jpeg';
    const imageData = (match ? match[2] : raw).replace(/\s+/g, '');
    if (imageData.length < 100 || imageData.length > 8_000_000) {
      throw new BadRequestException('Affiche invalide ou trop lourde (8 Mo max)');
    }
    return { mimeType, imageData };
  }

  private text(value: string | undefined, max: number) {
    return typeof value === 'string' ? value.trim().slice(0, max) || null : undefined;
  }

  async create(body: JobInput) {
    if (!body.image) throw new BadRequestException("L'affiche de l'offre est requise");
    const job = await this.prisma.jobOffer.create({
      data: {
        ...this.parseImage(body.image),
        title: this.text(body.title, 120) ?? null,
        description: this.text(body.description, 1000) ?? null,
        contact: this.text(body.contact, 200) ?? null,
      },
      select: this.listSelect,
    });
    await this.notifications.notifyAll({
      type: 'job',
      title: "Nouvelle offre d'emploi 💼",
      body: job.title ?? 'Une nouvelle offre est disponible dans l\'onglet Emplois.',
      data: { screen: 'jobs', jobId: job.id },
    });
    return this.toPublic(job);
  }

  async update(id: string, body: JobInput) {
    const exists = await this.prisma.jobOffer.findUnique({ where: { id }, select: { id: true } });
    if (!exists) throw new NotFoundException('Offre introuvable');
    const job = await this.prisma.jobOffer.update({
      where: { id },
      data: {
        ...(body.image ? this.parseImage(body.image) : {}),
        ...(body.title !== undefined ? { title: this.text(body.title, 120) } : {}),
        ...(body.description !== undefined ? { description: this.text(body.description, 1000) } : {}),
        ...(body.contact !== undefined ? { contact: this.text(body.contact, 200) } : {}),
        ...(typeof body.active === 'boolean' ? { active: body.active } : {}),
      },
      select: this.listSelect,
    });
    return this.toPublic(job);
  }

  async remove(id: string) {
    await this.prisma.jobOffer.deleteMany({ where: { id } });
    return { ok: true };
  }
}
