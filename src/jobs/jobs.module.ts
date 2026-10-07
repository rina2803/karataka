import { Module } from '@nestjs/common';
import { AdminGuard } from '../auth/admin.guard';
import { AuthModule } from '../auth/auth.module';
import { PrismaService } from '../prisma/prisma.service';
import { UsersModule } from '../users/users.module';
import { AdminJobsController, JobsController } from './jobs.controller';
import { JobsService } from './jobs.service';

@Module({
  imports: [AuthModule, UsersModule],
  controllers: [JobsController, AdminJobsController],
  providers: [JobsService, PrismaService, AdminGuard],
})
export class JobsModule {}
