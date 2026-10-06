import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { AuthService } from './auth.service';

/// Comme JwtAuthGuard mais laisse passer les visiteurs : pose `req.user`
/// seulement si un jeton valide est fourni (pages publiques personnalisables,
/// ex. « Suivre » déjà coché sur une page vendeur).
@Injectable()
export class OptionalJwtGuard implements CanActivate {
  constructor(private authService: AuthService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const header = request.headers.authorization as string | undefined;
    const [scheme, token] = (header ?? '').split(' ');
    if (scheme === 'Bearer' && token) {
      const payload = this.authService.verifyToken(token);
      if (payload) request.user = payload;
    }
    return true;
  }
}
