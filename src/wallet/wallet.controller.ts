import { Controller, Post, Body, Param, Req, UseGuards, UnauthorizedException, Get, ForbiddenException } from '@nestjs/common';
import { WalletService } from './wallet.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('wallet')
@UseGuards(JwtAuthGuard)
export class WalletController {
  constructor(private wallet: WalletService) {}

  @Get(':userId')
  async get(@Param('userId') userId: string, @Req() req: any) {
    const userIdFromToken = req.user?.sub;
    if (userIdFromToken !== userId) {
      throw new UnauthorizedException('You can only access your own wallet');
    }
    return this.wallet.getWalletForUser(userId);
  }

  @Get('history/:userId')
  async history(@Param('userId') userId: string, @Req() req: any) {
    const userIdFromToken = req.user?.sub;
    if (userIdFromToken !== userId) {
      throw new UnauthorizedException('You can only access your own wallet history');
    }
    return this.wallet.getWalletHistory(userId);
  }

  // Crédit/débit instantané sans passerelle de paiement — utile uniquement en
  // développement local pour tester sans MVola configuré. Désactivé en
  // production : le vrai flux passe par /payments/mvola/deposit|withdraw.
  private ensureDevOnly() {
    if (process.env.NODE_ENV === 'production') {
      throw new ForbiddenException('Utilisez le dépôt/retrait MVola (/payments/mvola) en production.');
    }
  }

  @Post('deposit/:userId')
  async deposit(@Param('userId') userId: string, @Body() body: { amount: string }, @Req() req: any) {
    this.ensureDevOnly();
    const userIdFromToken = req.user?.sub;
    if (userIdFromToken !== userId) {
      throw new UnauthorizedException('You can only deposit to your own wallet');
    }
    return this.wallet.deposit(userId, body.amount, { via: 'dev-api' });
  }

  @Post('withdraw/:userId')
  async withdraw(@Param('userId') userId: string, @Body() body: { amount: string }, @Req() req: any) {
    this.ensureDevOnly();
    const userIdFromToken = req.user?.sub;
    if (userIdFromToken !== userId) {
      throw new UnauthorizedException('You can only withdraw from your own wallet');
    }
    return this.wallet.withdraw(userId, body.amount, { via: 'dev-api' });
  }
}
