import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Socket } from 'socket.io';
import { AuthService } from './auth.service';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const contextType = context.getType<string>();
    if (contextType === 'ws') {
      const client = context.switchToWs().getClient<Socket>();
      const token = this.extractTokenFromSocket(client);
      if (!token) throw new UnauthorizedException('Missing authentication token');
      const payload = this.authService.verifyToken(token);
      if (!payload) throw new UnauthorizedException('Invalid authentication token');
      client.data.user = payload;
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers.authorization || request.headers.Authorization;
    const token = this.extractTokenFromHeader(authHeader);
    if (!token) throw new UnauthorizedException('Missing authentication token');
    const payload = this.authService.verifyToken(token);
    if (!payload) throw new UnauthorizedException('Invalid authentication token');
    request.user = payload;
    return true;
  }

  private extractTokenFromHeader(header: string | string[] | undefined): string | null {
    if (!header) return null;
    const value = Array.isArray(header) ? header[0] : header;
    const [scheme, token] = value.split(' ');
    if (scheme !== 'Bearer' || !token) return null;
    return token;
  }

  private extractTokenFromSocket(socket: Socket): string | null {
    if (socket.handshake?.auth?.token) {
      return socket.handshake.auth.token as string;
    }
    const query = socket.handshake?.query;
    if (query && typeof query === 'object' && 'token' in query) {
      const queryToken = query.token;
      return Array.isArray(queryToken) ? queryToken[0] : (queryToken as string);
    }
    return null;
  }
}
