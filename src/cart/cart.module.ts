import { Module } from '@nestjs/common';
import { CartController } from './cart.controller';
import { AdminCartController } from './admin-cart.controller';
import { CartService } from './cart.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { AdminGuard } from '../auth/admin.guard';
import { PointsModule } from '../points/points.module';

@Module({
  imports: [AuthModule, UsersModule, PointsModule],
  controllers: [CartController, AdminCartController],
  providers: [CartService, PrismaService, AdminGuard],
})
export class CartModule {}
