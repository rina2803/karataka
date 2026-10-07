import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/// Réglages que l'admin peut changer depuis l'app. Les valeurs secrètes ne
/// sont jamais renvoyées en clair (seulement leurs 4 derniers caractères).
export const SETTING_DEFS = [
  { key: 'GEMINI_API_KEY', label: 'Clé API Google Gemini', secret: true, help: 'aistudio.google.com → Get API key' },
  { key: 'GEMINI_TEXT_MODEL', label: 'Modèle Gemini (texte)', secret: false, help: 'Par défaut : gemini-2.5-flash' },
  { key: 'GEMINI_IMAGE_MODEL', label: 'Modèle Gemini (images)', secret: false, help: 'Par défaut : gemini-2.5-flash-image' },
  { key: 'FB_APP_ID', label: 'Facebook : identifiant de l’application', secret: false, help: 'developers.facebook.com → votre app → Paramètres' },
  { key: 'FB_APP_SECRET', label: 'Facebook : clé secrète de l’application', secret: true, help: 'developers.facebook.com → Paramètres → Général' },
  { key: 'PUBLIC_WEB_URL', label: 'Adresse publique des liens partagés', secret: false, help: 'Vide = adresse du serveur. Ex. : https://karataka.mg' },
] as const;

export type SettingKey = (typeof SETTING_DEFS)[number]['key'];

@Injectable()
export class SettingsService implements OnModuleInit {
  private readonly log = new Logger(SettingsService.name);
  private values = new Map<string, string>();

  constructor(private prisma: PrismaService) {}

  async onModuleInit() {
    await this.reload();
  }

  private async reload() {
    try {
      const rows = await this.prisma.appSetting.findMany();
      this.values = new Map(rows.map((r) => [r.key, r.value]));
    } catch (error) {
      this.log.warn(`settings: ${(error as Error).message}`);
    }
  }

  /// Réglage de l'admin, sinon variable d'environnement, sinon vide.
  get(key: SettingKey): string {
    return (this.values.get(key) ?? process.env[key] ?? '').trim();
  }

  list() {
    return SETTING_DEFS.map((d) => {
      const value = this.get(d.key);
      const fromAdmin = this.values.has(d.key);
      return {
        key: d.key,
        label: d.label,
        help: d.help,
        secret: d.secret,
        set: !!value,
        source: fromAdmin ? 'admin' : value ? 'serveur' : null,
        value: d.secret ? (value ? `••••${value.slice(-4)}` : '') : value,
      };
    });
  }

  async set(key: string, value: string) {
    if (!SETTING_DEFS.some((d) => d.key === key)) return false;
    const clean = value.trim();
    if (clean) {
      await this.prisma.appSetting.upsert({ where: { key }, create: { key, value: clean }, update: { value: clean } });
    } else {
      await this.prisma.appSetting.deleteMany({ where: { key } });
    }
    await this.reload();
    return true;
  }
}
