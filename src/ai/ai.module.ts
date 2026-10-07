import { Module } from '@nestjs/common';
import { AdminGuard } from '../auth/admin.guard';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { PrismaService } from '../prisma/prisma.service';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { GeminiService } from './gemini.service';

@Module({
  imports: [AuthModule, UsersModule],
  controllers: [AiController],
  providers: [AiService, GeminiService, PrismaService, AdminGuard],
  exports: [AiService, GeminiService],
})
export class AiModule {}
