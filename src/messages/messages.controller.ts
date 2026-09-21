import { Controller, Get, Param, Query } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Controller('messages')
export class MessagesController {
  constructor(private prisma: PrismaService) {}

  @Get('room/:roomId')
  async getRoomMessages(@Param('roomId') roomId: string, @Query('limit') limit?: string) {
    const take = Math.max(1, Math.min(parseInt(limit ?? '20', 10) || 20, 50));

    const messages = await this.prisma.message.findMany({
      where: { roomId },
      orderBy: { createdAt: 'desc' },
      take,
      include: {
        user: {
          select: { id: true, username: true },
        },
      },
    });

    return messages.reverse().map((message) => ({
      id: message.id,
      roomId: message.roomId,
      userId: message.userId,
      username: message.user.username,
      content: message.content,
      createdAt: message.createdAt,
    }));
  }
}
