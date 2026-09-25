import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AppReleaseService {
  constructor(private prisma: PrismaService) {}

  async latest(platform: string) {
    const release = await this.prisma.appRelease.findFirst({
      where: { platform },
      orderBy: { buildNumber: 'desc' },
    });
    return release ?? null;
  }

  listAll() {
    return this.prisma.appRelease.findMany({ orderBy: { createdAt: 'desc' } });
  }

  create(body: { platform?: string; version: string; buildNumber: number; apkUrl: string; notes?: string; mandatory?: boolean }) {
    return this.prisma.appRelease.create({
      data: {
        platform: body.platform?.trim() || 'android',
        version: body.version.trim(),
        buildNumber: Number(body.buildNumber),
        apkUrl: body.apkUrl.trim(),
        notes: body.notes?.trim() || null,
        mandatory: Boolean(body.mandatory),
      },
    });
  }

  delete(id: string) {
    return this.prisma.appRelease.delete({ where: { id } });
  }
}
