import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/// Un seul client Prisma pour toute l'API : chaque instance ouvrait son
/// propre groupe de connexions à la base (lent avec Neon, et gourmand en
/// mémoire sur le serveur gratuit).
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
