import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaService } from '../prisma/prisma.service';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { GeminiService } from './gemini.service';

@Module({
  imports: [AuthModule],
  controllers: [AiController],
  providers: [AiService, GeminiService, PrismaService],
  exports: [AiService, GeminiService],
})
export class AiModule {}
