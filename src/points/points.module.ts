import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthModule } from '../auth/auth.module';
import { PointsController } from './points.controller';
import { PointsService } from './points.service';

@Module({
  imports: [AuthModule],
  controllers: [PointsController],
  providers: [PointsService, PrismaService],
  exports: [PointsService],
})
export class PointsModule {}
