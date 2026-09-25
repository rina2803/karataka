import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SellerService {
  constructor(private prisma: PrismaService) {}

  async apply(
    userId: string,
    body: { cinNumber: string; cinPhotoBase64: string; selfieBase64: string; mvolaNumber: string },
  ) {
    const cinNumber = body.cinNumber?.trim();
    const mvolaNumber = body.mvolaNumber?.trim();
    if (!cinNumber) throw new BadRequestException('Le numéro de CIN est requis');
    if (!body.cinPhotoBase64) throw new BadRequestException('La photo de la CIN est requise');
    if (!body.selfieBase64) throw new BadRequestException('Le selfie avec la CIN est requis');
    if (!mvolaNumber) throw new BadRequestException('Le numéro MVola est requis');

    const existing = await this.prisma.sellerApplication.findFirst({
      where: { userId, status: { in: ['pending', 'approved'] } },
      orderBy: { createdAt: 'desc' },
    });
    if (existing) return { ok: true, alreadySubmitted: true, application: existing };

    const application = await this.prisma.sellerApplication.create({
      data: {
        userId,
        cinNumber,
        cinPhotoUrl: body.cinPhotoBase64,
        selfieUrl: body.selfieBase64,
        mvolaNumber,
      },
    });
    return { ok: true, alreadySubmitted: false, application };
  }

  async status(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { isApprovedSeller: true } });
    const latest = await this.prisma.sellerApplication.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    return {
      isApprovedSeller: user?.isApprovedSeller ?? false,
      application: latest
        ? { id: latest.id, status: latest.status, reviewNote: latest.reviewNote, createdAt: latest.createdAt }
        : null,
    };
  }

  async listApplications(status?: string) {
    return this.prisma.sellerApplication.findMany({
      where: status ? { status } : undefined,
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: {
        user: { select: { id: true, username: true, displayName: true, avatarColor: true, email: true, phone: true } },
      },
    });
  }

  async approve(id: string) {
    const application = await this.prisma.sellerApplication.findUnique({ where: { id } });
    if (!application) throw new NotFoundException('Candidature introuvable');
    if (application.status !== 'pending') throw new BadRequestException('Cette candidature a déjà été traitée');

    return this.prisma.$transaction(async (tx) => {
      await tx.sellerApplication.update({ where: { id }, data: { status: 'approved', reviewedAt: new Date() } });
      await tx.user.update({ where: { id: application.userId }, data: { isApprovedSeller: true } });
      return { ok: true };
    });
  }

  async reject(id: string, reviewNote?: string) {
    const application = await this.prisma.sellerApplication.findUnique({ where: { id } });
    if (!application) throw new NotFoundException('Candidature introuvable');
    if (application.status !== 'pending') throw new BadRequestException('Cette candidature a déjà été traitée');

    await this.prisma.sellerApplication.update({
      where: { id },
      data: { status: 'rejected', reviewedAt: new Date(), reviewNote: reviewNote ?? null },
    });
    return { ok: true };
  }
}
