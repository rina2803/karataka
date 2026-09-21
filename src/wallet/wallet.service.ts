import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class WalletService {
  constructor(private prisma: PrismaService) {}

  async getWalletForUser(userId: string) {
    return this.prisma.wallet.findUnique({
      where: { userId },
      include: { txns: { orderBy: { createdAt: 'desc' } } },
    });
  }

  async getWalletHistory(userId: string) {
    const wallet = await this.getWalletForUser(userId);
    if (!wallet) throw new BadRequestException('Wallet not found');
    return wallet.txns;
  }

  async deposit(userId: string, amount: string, meta?: any) {
    if (Number(amount) <= 0) throw new BadRequestException('Amount must be > 0');
    const wallet = await this.getWalletForUser(userId);
    if (!wallet) throw new BadRequestException('Wallet not found');
    const newBalance = (Number(wallet.balance) + Number(amount)).toString();

    await this.prisma.transaction.create({
      data: { walletId: wallet.id, amount: amount, type: 'deposit', meta: typeof meta === 'string' ? meta : JSON.stringify(meta) },
    });

    return this.prisma.wallet.update({ where: { id: wallet.id }, data: { balance: newBalance } });
  }

  async withdraw(userId: string, amount: string, meta?: any) {
    const wallet = await this.getWalletForUser(userId);
    if (!wallet) throw new BadRequestException('Wallet not found');
    if (Number(wallet.balance) < Number(amount)) throw new BadRequestException('Insufficient funds');

    const newBalance = (Number(wallet.balance) - Number(amount)).toString();
    await this.prisma.transaction.create({
      data: { walletId: wallet.id, amount: '-' + amount, type: 'withdraw', meta: typeof meta === 'string' ? meta : JSON.stringify(meta) },
    });

    return this.prisma.wallet.update({ where: { id: wallet.id }, data: { balance: newBalance } });
  }

  /** Débite la mise d'un joueur au début d'une partie payante (séquestre). */
  async placeBet(userId: string, amount: string, meta?: any) {
    const wallet = await this.getWalletForUser(userId);
    if (!wallet) throw new BadRequestException('Wallet not found');
    if (Number(wallet.balance) < Number(amount)) throw new BadRequestException('Insufficient funds');

    const newBalance = (Number(wallet.balance) - Number(amount)).toString();
    await this.prisma.transaction.create({
      data: { walletId: wallet.id, amount: '-' + amount, type: 'bet', meta: typeof meta === 'string' ? meta : JSON.stringify(meta) },
    });
    return this.prisma.wallet.update({ where: { id: wallet.id }, data: { balance: newBalance } });
  }

  /** Rembourse une mise (ex: partie nulle, adversaire n'a jamais rejoint). */
  async refundBet(userId: string, amount: string, meta?: any) {
    const wallet = await this.getWalletForUser(userId);
    if (!wallet) throw new BadRequestException('Wallet not found');
    const newBalance = (Number(wallet.balance) + Number(amount)).toString();
    await this.prisma.transaction.create({
      data: { walletId: wallet.id, amount: amount, type: 'refund', meta: typeof meta === 'string' ? meta : JSON.stringify(meta) },
    });
    return this.prisma.wallet.update({ where: { id: wallet.id }, data: { balance: newBalance } });
  }

  async hasSufficientBalance(userId: string, amount: string) {
    const wallet = await this.getWalletForUser(userId);
    return !!wallet && Number(wallet.balance) >= Number(amount);
  }

  async distributePayouts(winnerUserId: string, totalAmount: string) {
    const fee = (Number(totalAmount) * 0.10).toFixed(2);
    const payout = (Number(totalAmount) - Number(fee)).toFixed(2);

    const winnerWallet = await this.getWalletForUser(winnerUserId);
    if (!winnerWallet) throw new BadRequestException('Winner wallet not found');

    await this.prisma.transaction.create({
      data: { walletId: winnerWallet.id, amount: payout, type: 'payout', meta: JSON.stringify({ total: totalAmount, fee }) },
    });
    await this.prisma.wallet.update({ where: { id: winnerWallet.id }, data: { balance: (Number(winnerWallet.balance) + Number(payout)).toString() } });

    let platformWallet = await this.prisma.wallet.findFirst({ where: { userId: null } });
    if (!platformWallet) {
      platformWallet = await this.prisma.wallet.create({ data: { balance: fee } });
      await this.prisma.transaction.create({ data: { walletId: platformWallet.id, amount: fee, type: 'fee', meta: JSON.stringify({ source: 'platform' }) } });
    } else {
      await this.prisma.transaction.create({ data: { walletId: platformWallet.id, amount: fee, type: 'fee', meta: JSON.stringify({ source: 'platform' }) } });
      await this.prisma.wallet.update({ where: { id: platformWallet.id }, data: { balance: (Number(platformWallet.balance) + Number(fee)).toString() } });
    }

    return { fee, payout };
  }
}
