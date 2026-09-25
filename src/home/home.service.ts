import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class HomeService {
  constructor(private prisma: PrismaService) {}

  listActiveBanners() {
    return this.prisma.homeBanner.findMany({
      where: { active: true },
      orderBy: { sortOrder: 'asc' },
    });
  }

  listAllBanners() {
    return this.prisma.homeBanner.findMany({ orderBy: { sortOrder: 'asc' } });
  }

  createBanner(body: { title: string; imageUrl: string; linkType?: string; linkValue?: string; sortOrder?: number }) {
    return this.prisma.homeBanner.create({
      data: {
        title: body.title.trim(),
        imageUrl: body.imageUrl.trim(),
        linkType: body.linkType?.trim() || null,
        linkValue: body.linkValue?.trim() || null,
        sortOrder: Number(body.sortOrder ?? 0),
      },
    });
  }

  updateBanner(
    id: string,
    body: { title?: string; imageUrl?: string; linkType?: string; linkValue?: string; sortOrder?: number; active?: boolean },
  ) {
    return this.prisma.homeBanner.update({
      where: { id },
      data: {
        ...(body.title !== undefined ? { title: body.title.trim() } : {}),
        ...(body.imageUrl !== undefined ? { imageUrl: body.imageUrl.trim() } : {}),
        ...(body.linkType !== undefined ? { linkType: body.linkType?.trim() || null } : {}),
        ...(body.linkValue !== undefined ? { linkValue: body.linkValue?.trim() || null } : {}),
        ...(body.sortOrder !== undefined ? { sortOrder: Number(body.sortOrder) } : {}),
        ...(body.active !== undefined ? { active: body.active } : {}),
      },
    });
  }

  deleteBanner(id: string) {
    return this.prisma.homeBanner.delete({ where: { id } });
  }
}
