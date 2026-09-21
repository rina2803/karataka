import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { UsersService } from '../users/users.service';

/**
 * À utiliser APRÈS JwtAuthGuard (qui pose req.user.sub). Vérifie que
 * l'utilisateur authentifié a le rôle "admin" en base — le rôle n'est pas
 * mis dans le token JWT pour pouvoir être révoqué immédiatement.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private users: UsersService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const userId = request.user?.sub;
    if (!userId || !(await this.users.isAdmin(userId))) {
      throw new ForbiddenException('Accès réservé aux administrateurs');
    }
    return true;
  }
}
