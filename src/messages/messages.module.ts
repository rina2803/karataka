import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MessagesController } from './messages.controller';

@Module({
  controllers: [MessagesController],
  providers: [PrismaService],
})
export class MessagesModule {}
