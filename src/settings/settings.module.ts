import { Global, Module } from '@nestjs/common';
import { AdminGuard } from '../auth/admin.guard';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';

@Global()
@Module({
  imports: [AuthModule, UsersModule],
  controllers: [SettingsController],
  providers: [SettingsService, AdminGuard],
  exports: [SettingsService],
})
export class SettingsModule {}
