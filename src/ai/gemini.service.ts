import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { SettingsService } from '../settings/settings.service';

/// Appels à l'API Google Gemini, uniquement côté serveur : la clé
/// GEMINI_API_KEY ne quitte jamais le serveur. Les noms de modèles sont
/// réglables (GEMINI_TEXT_MODEL, GEMINI_IMAGE_MODEL) pour suivre les
/// nouvelles versions sans republier.
const API = 'https://generativelanguage.googleapis.com/v1beta/models';

interface Part {
  text?: string;
  inlineData?: { mimeType: string; data: string };
}

@Injectable()
export class GeminiService {
  private readonly log = new Logger(GeminiService.name);

  constructor(private settings: SettingsService) {}

  get enabled() {
    return !!this.settings.get('GEMINI_API_KEY');
  }

  private get textModel() {
    return this.settings.get('GEMINI_TEXT_MODEL') || 'gemini-2.5-flash';
  }

  private get imageModel() {
    return this.settings.get('GEMINI_IMAGE_MODEL') || 'gemini-2.5-flash-image';
  }

  private async call(model: string, parts: Part[], generationConfig: Record<string, unknown>) {
    const key = this.settings.get('GEMINI_API_KEY');
    if (!key) throw new ServiceUnavailableException("L'IA n'est pas encore activée sur Karataka");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 90_000);
    try {
      const res = await fetch(`${API}/${model}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig }),
        signal: controller.signal,
      });
      const body: any = await res.json().catch(() => ({}));
      if (!res.ok) {
        this.log.warn(`Gemini ${model} ${res.status}: ${JSON.stringify(body?.error ?? body).slice(0, 300)}`);
        if ([400, 401, 403].includes(res.status) && /api.?key/i.test(JSON.stringify(body?.error ?? ''))) {
          throw new ServiceUnavailableException('Clé Gemini refusée par Google : vérifiez-la dans Admin → Paramètres');
        }
        if (res.status === 404) {
          throw new ServiceUnavailableException(`Modèle Gemini « ${model} » introuvable : changez-le dans Admin → Paramètres`);
        }
        throw new ServiceUnavailableException("Le service d'IA est momentanément indisponible");
      }
      return (body?.candidates?.[0]?.content?.parts ?? []) as Part[];
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      this.log.warn(`Gemini ${model}: ${(error as Error).message}`);
      throw new ServiceUnavailableException("Le service d'IA ne répond pas, réessayez");
    } finally {
      clearTimeout(timer);
    }
  }

  /// Test de la clé depuis l'écran admin : petite requête texte.
  async ping() {
    const out = await this.json<{ ok?: boolean }>('Réponds exactement {"ok": true}');
    return out.ok === true;
  }

  /// Réponse JSON structurée (le modèle est contraint au format JSON).
  async json<T>(prompt: string, image?: { mimeType: string; data: string }): Promise<T> {
    const parts: Part[] = [{ text: prompt }];
    if (image) parts.push({ inlineData: image });
    const out = await this.call(this.textModel, parts, { responseMimeType: 'application/json', temperature: 0.7 });
    const text = out.map((p) => p.text ?? '').join('');
    try {
      return JSON.parse(text) as T;
    } catch {
      this.log.warn(`Gemini JSON invalide: ${text.slice(0, 200)}`);
      throw new ServiceUnavailableException("L'IA a donné une réponse illisible, réessayez");
    }
  }

  /// Image générée (ou retouchée si une photo est fournie). Renvoie du base64.
  async image(prompt: string, photo?: { mimeType: string; data: string }) {
    const parts: Part[] = [{ text: prompt }];
    if (photo) parts.push({ inlineData: photo });
    const out = await this.call(this.imageModel, parts, { responseModalities: ['TEXT', 'IMAGE'] });
    const img = out.find((p) => p.inlineData?.data);
    if (!img?.inlineData) throw new ServiceUnavailableException("L'IA n'a pas pu créer d'image, essayez une autre description");
    return { mimeType: img.inlineData.mimeType || 'image/png', data: img.inlineData.data };
  }
}
