import { Global, Module } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { AdminGuard } from '../auth/admin.guard';
import { AdminNotificationsController, NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

/// Global : une seule instance (connexion Firebase + serveur socket) partagée
/// par tous les modules qui notifient (commandes, vendeurs, tournois…).
@Global()
@Module({
  imports: [AuthModule, UsersModule],
  controllers: [NotificationsController, AdminNotificationsController],
  providers: [NotificationsService, PrismaService, AdminGuard],
  exports: [NotificationsService],
})
export class NotificationsModule {}
