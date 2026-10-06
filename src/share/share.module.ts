import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ShareController } from './share.controller';

@Module({
  controllers: [ShareController],
  providers: [PrismaService],
})
export class ShareModule {}
