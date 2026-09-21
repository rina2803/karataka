import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { randomUUID } from 'crypto';

interface MvolaConfig {
  baseUrl: string;
  consumerKey: string;
  consumerSecret: string;
  /** Numéro MVola "caisse" de l'admin — reçoit les dépôts, paie les retraits. */
  merchantMsisdn: string;
  partnerName: string;
}

export interface MvolaRequestResult {
  ok: boolean;
  serverCorrelationId?: string;
  error?: string;
}

export interface MvolaStatusResult {
  status: 'pending' | 'completed' | 'failed';
  error?: string;
}

/**
 * Intégration MVola (Telma) — dépôt/retrait par mobile money.
 *
 * Fonctionnement réel : une demande envoie une notification de confirmation
 * (USSD/push) sur le téléphone du client, qui valide avec son code MVola.
 * Nécessite un compte marchand MVola (Consumer Key/Secret obtenus auprès de
 * Telma) configuré via les variables d'environnement MVOLA_*. Sans ces
 * identifiants, le service répond honnêtement "non configuré" plutôt que de
 * simuler une confirmation.
 */
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);
  private tokenCache: { token: string; expiresAt: number } | null = null;

  private config(): MvolaConfig | null {
    const consumerKey = process.env.MVOLA_CONSUMER_KEY;
    const consumerSecret = process.env.MVOLA_CONSUMER_SECRET;
    if (!consumerKey || !consumerSecret) return null;
    return {
      baseUrl: process.env.MVOLA_API_BASE || 'https://devapi.mvola.mg',
      consumerKey,
      consumerSecret,
      merchantMsisdn: process.env.MVOLA_MERCHANT_MSISDN || '0345437720',
      partnerName: process.env.MVOLA_PARTNER_NAME || 'Lalao sy Karataka',
    };
  }

  isConfigured(): boolean {
    return this.config() !== null;
  }

  private async getToken(cfg: MvolaConfig): Promise<string> {
    if (this.tokenCache && this.tokenCache.expiresAt > Date.now()) return this.tokenCache.token;
    const basic = Buffer.from(`${cfg.consumerKey}:${cfg.consumerSecret}`).toString('base64');
    const res = await axios.post(
      `${cfg.baseUrl}/token?grant_type=client_credentials&scope=EXT_INT_MVOLA_SCOPE`,
      {},
      { headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' } },
    );
    const token = res.data.access_token as string;
    const expiresIn = Number(res.data.expires_in) || 3500;
    this.tokenCache = { token, expiresAt: Date.now() + expiresIn * 1000 };
    return token;
  }

  /** Demande de paiement du client vers la caisse admin (dépôt). */
  async requestDeposit(customerPhone: string, amount: number, reference: string): Promise<MvolaRequestResult> {
    const cfg = this.config();
    if (!cfg) return { ok: false, error: 'MVola non configuré côté serveur (MVOLA_CONSUMER_KEY/SECRET manquants)' };
    try {
      const token = await this.getToken(cfg);
      const correlationId = randomUUID();
      const res = await axios.post(
        `${cfg.baseUrl}/mvola/mm/transactions/type/merchantpay/1.0.0/`,
        {
          amount: String(amount),
          currency: 'Ar',
          descriptionText: 'Depot Lalao sy Karataka',
          requestingOrganisationTransactionReference: reference,
          requestDate: new Date().toISOString(),
          debitParty: [{ key: 'msisdn', value: customerPhone }],
          creditParty: [{ key: 'msisdn', value: cfg.merchantMsisdn }],
          metadata: [{ key: 'partnerName', value: cfg.partnerName }],
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Version: '1.0',
            'X-CorrelationID': correlationId,
            UserLanguage: 'FR',
            UserAccountIdentifier: `msisdn;${cfg.merchantMsisdn}`,
            partnerName: cfg.partnerName,
            'Content-Type': 'application/json',
            'Cache-Control': 'no-cache',
          },
        },
      );
      return { ok: true, serverCorrelationId: res.data?.serverCorrelationId || correlationId };
    } catch (e: any) {
      this.logger.error('MVola deposit request failed', e?.response?.data || e.message);
      return { ok: false, error: 'Échec de la demande MVola. Réessayez.' };
    }
  }

  /** Demande de paiement de la caisse admin vers le client (retrait). */
  async requestWithdrawal(customerPhone: string, amount: number, reference: string): Promise<MvolaRequestResult> {
    const cfg = this.config();
    if (!cfg) return { ok: false, error: 'MVola non configuré côté serveur (MVOLA_CONSUMER_KEY/SECRET manquants)' };
    try {
      const token = await this.getToken(cfg);
      const correlationId = randomUUID();
      const res = await axios.post(
        `${cfg.baseUrl}/mvola/mm/transactions/type/disbursement/1.0.0/`,
        {
          amount: String(amount),
          currency: 'Ar',
          descriptionText: 'Retrait Lalao sy Karataka',
          requestingOrganisationTransactionReference: reference,
          requestDate: new Date().toISOString(),
          debitParty: [{ key: 'msisdn', value: cfg.merchantMsisdn }],
          creditParty: [{ key: 'msisdn', value: customerPhone }],
          metadata: [{ key: 'partnerName', value: cfg.partnerName }],
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Version: '1.0',
            'X-CorrelationID': correlationId,
            UserLanguage: 'FR',
            UserAccountIdentifier: `msisdn;${cfg.merchantMsisdn}`,
            partnerName: cfg.partnerName,
            'Content-Type': 'application/json',
          },
        },
      );
      return { ok: true, serverCorrelationId: res.data?.serverCorrelationId || correlationId };
    } catch (e: any) {
      this.logger.error('MVola withdrawal request failed', e?.response?.data || e.message);
      return { ok: false, error: 'Échec de la demande MVola. Réessayez.' };
    }
  }

  async checkStatus(
    serverCorrelationId: string,
    type: 'merchantpay' | 'disbursement' = 'merchantpay',
  ): Promise<MvolaStatusResult> {
    const cfg = this.config();
    if (!cfg) return { status: 'failed', error: 'MVola non configuré' };
    try {
      const token = await this.getToken(cfg);
      const res = await axios.get(
        `${cfg.baseUrl}/mvola/mm/transactions/type/${type}/1.0.0/status/${serverCorrelationId}`,
        { headers: { Authorization: `Bearer ${token}`, Version: '1.0', UserLanguage: 'FR' } },
      );
      const raw = (res.data?.status || 'pending').toString().toLowerCase();
      const status: MvolaStatusResult['status'] = raw === 'completed' ? 'completed' : raw === 'failed' ? 'failed' : 'pending';
      return { status };
    } catch (e: any) {
      this.logger.error('MVola status check failed', e?.response?.data || e.message);
      return { status: 'pending' };
    }
  }
}
