/**
 * GUARDIAN BOT - Automod Engine
 * Motor de automoderación con detección avanzada
 */

import { Message, GuildMember, PermissionFlagsBits } from 'discord.js';
import { prisma } from '../database/client';
import { redis, cacheWithFallback, CacheKeys, incrementCounter } from '../database/redis';
import { ModerationService } from '../services/moderationService';
import { logger } from '../utils/logger';
import type { AutomodViolation, AutomodViolationType } from '../types';
import type { GuardianClient } from '../bot';

// Dominios de phishing conocidos (se actualizan periódicamente)
const PHISHING_DOMAINS = new Set([
  'discord-nitro.gift', 'discordgift.site', 'discord-app.com', 'dlscord.com',
  'discords.gift', 'discordnitrogift.com', 'free-nitro.ru', 'steamcommunily.com',
]);

// Patrones de scam
const SCAM_PATTERNS = [
  /free\s*nitro/i, /discord.*nitro.*gift/i, /get\s*nitro\s*free/i,
  /click.*claim.*prize/i, /you.*won.*gift/i, /congratulations.*winner/i,
];

// Patrones de phishing
const PHISHING_PATTERNS = [
  /steam.*trade.*login/i, /verify.*account.*click/i,
  /account.*suspended.*verify/i, /unusual.*activity.*confirm/i,
];

export class AutomodEngine {
  private botId: string;

  constructor(botId: string) {
    this.botId = botId;
  }

  // ================================
  // PUNTO DE ENTRADA
  // ================================

  async check(message: Message): Promise<AutomodViolation | null> {
    if (!message.guild || !message.member) return null;
    if (message.author.bot) return null;
    if (message.member.permissions.has(PermissionFlagsBits.Administrator)) return null;

    const config = await this.getConfig(message.guild.id);
    if (!config?.enabled) return null;

    // Verificar si el canal o rol está exento
    if (config.whitelistChannels.includes(message.channelId)) return null;
    const memberRoles = message.member.roles.cache.map((r) => r.id);
    if (memberRoles.some((r) => config.whitelistRoles.includes(r))) return null;

    // Ejecutar verificaciones en orden de prioridad
    const checks = [
      config.antiPhishing && this.checkPhishing(message),
      config.antiScam && this.checkScam(message),
      config.antiInvites && this.checkInvites(message, config),
      config.antiSpam && this.checkSpam(message, config),
      config.antiFlood && this.checkFlood(message, config),
      config.antiMassMentions && this.checkMassMentions(message, config),
      config.antiRepeat && this.checkDuplicate(message, config),
      config.badWords && this.checkBadWords(message, config),
      config.suspiciousLinks && this.checkSuspiciousLinks(message),
    ].filter(Boolean);

    for (const check of checks) {
      const result = await (check as Promise<AutomodViolation | null>);
      if (result) return result;
    }

    return null;
  }

  // ================================
  // APLICAR SANCIÓN
  // ================================

  async applyAction(message: Message, violation: AutomodViolation): Promise<void> {
    if (!message.guild || !message.member) return;

    // Borrar mensaje
    await message.delete().catch(() => null);

    const botId = this.botId;
    const opts = {
      guildId: message.guild.id,
      targetId: message.author.id,
      moderatorId: botId,
      reason: `[AutoMod] ${violation.reason}`,
      silent: true,
    };

    switch (violation.action) {
      case 'WARN':
        await ModerationService.warn(message.guild, { ...opts, action: 'WARN' });
        break;
      case 'TIMEOUT':
        await ModerationService.timeout(message.guild, {
          ...opts,
          action: 'TIMEOUT',
          duration: 300, // 5 minutos por defecto
        });
        break;
      case 'KICK':
        await ModerationService.kick(message.guild, { ...opts, action: 'KICK' });
        break;
      case 'BAN':
        await ModerationService.ban(message.guild, { ...opts, action: 'BAN' });
        break;
    }

    // Notificar en el canal (se borra tras 5s)
    try {
      const notification = await message.channel.send({
        content: `⚠️ **${message.author.tag}** - ${violation.reason}`,
      });
      setTimeout(() => notification.delete().catch(() => null), 5000);
    } catch {
      // Ignorar si no se puede enviar
    }

    logger.info(
      `[AutoMod] ${violation.type} detectado de ${message.author.tag} en ${message.guild.name}: ${violation.reason}`
    );
  }

  // ================================
  // CHECKS INDIVIDUALES
  // ================================

  private async checkPhishing(message: Message): Promise<AutomodViolation | null> {
    const content = message.content.toLowerCase();

    // Verificar URLs contra lista de phishing
    const urlRegex = /https?:\/\/([^\s/]+)/g;
    let match;
    while ((match = urlRegex.exec(content)) !== null) {
      const domain = match[1]?.toLowerCase() ?? '';
      if (PHISHING_DOMAINS.has(domain)) {
        return {
          type: 'PHISHING',
          severity: 'CRITICAL',
          action: 'BAN',
          reason: `Enlace de phishing detectado: ${domain}`,
          content: message.content,
        };
      }
    }

    // Verificar patrones de phishing
    for (const pattern of PHISHING_PATTERNS) {
      if (pattern.test(content)) {
        return {
          type: 'PHISHING',
          severity: 'CRITICAL',
          action: 'BAN',
          reason: 'Intento de phishing detectado',
          content: message.content,
        };
      }
    }

    return null;
  }

  private async checkScam(message: Message): Promise<AutomodViolation | null> {
    const content = message.content.toLowerCase();

    for (const pattern of SCAM_PATTERNS) {
      if (pattern.test(content)) {
        return {
          type: 'SCAM',
          severity: 'HIGH',
          action: 'BAN',
          reason: 'Mensaje de estafa detectado',
          content: message.content,
        };
      }
    }

    return null;
  }

  private async checkInvites(message: Message, config: any): Promise<AutomodViolation | null> {
    const inviteRegex = /discord(?:\.gg|app\.com\/invite|\.com\/invite)\/([a-zA-Z0-9-]+)/g;
    if (inviteRegex.test(message.content)) {
      return {
        type: 'INVITE',
        severity: 'MEDIUM',
        action: config.inviteAction ?? 'WARN',
        reason: 'Enlace de invitación de Discord no permitido',
        content: message.content,
      };
    }
    return null;
  }

  private async checkSpam(message: Message, config: any): Promise<AutomodViolation | null> {
    const key = CacheKeys.memberSpam(message.guild!.id, message.author.id);
    const count = await incrementCounter(key, 5); // 5 segundos ventana

    if (count > (config.spamThreshold ?? 5)) {
      return {
        type: 'SPAM',
        severity: 'HIGH',
        action: config.spamAction ?? 'TIMEOUT',
        reason: `Spam detectado: ${count} mensajes en 5 segundos`,
      };
    }
    return null;
  }

  private async checkFlood(message: Message, config: any): Promise<AutomodViolation | null> {
    const threshold = config.floodThreshold ?? 1000;
    if (message.content.length > threshold) {
      return {
        type: 'FLOOD',
        severity: 'MEDIUM',
        action: 'WARN',
        reason: `Mensaje demasiado largo: ${message.content.length} caracteres`,
      };
    }
    return null;
  }

  private async checkMassMentions(message: Message, config: any): Promise<AutomodViolation | null> {
    const mentions = message.mentions.users.size + message.mentions.roles.size;
    const threshold = config.mentionThreshold ?? 10;

    if (mentions > threshold) {
      return {
        type: 'MASS_MENTIONS',
        severity: 'HIGH',
        action: 'TIMEOUT',
        reason: `Menciones masivas: ${mentions} menciones en un mensaje`,
      };
    }
    return null;
  }

  private async checkDuplicate(message: Message, config: any): Promise<AutomodViolation | null> {
    const key = `duplicate:${message.guild!.id}:${message.author.id}`;
    const history = await redis.lrange(key, 0, (config.duplicateThreshold ?? 3) - 1);

    const isDuplicate = history.includes(message.content);
    await redis.lpush(key, message.content);
    await redis.ltrim(key, 0, 9);
    await redis.expire(key, 30);

    if (isDuplicate) {
      const dupCount = history.filter((m) => m === message.content).length + 1;
      if (dupCount >= (config.duplicateThreshold ?? 3)) {
        return {
          type: 'DUPLICATE',
          severity: 'MEDIUM',
          action: 'WARN',
          reason: `Mensajes duplicados detectados (${dupCount} veces)`,
          content: message.content,
        };
      }
    }

    return null;
  }

  private async checkBadWords(message: Message, config: any): Promise<AutomodViolation | null> {
    const content = message.content.toLowerCase();
    const bannedWords: string[] = config.bannedWords ?? [];

    for (const word of bannedWords) {
      if (content.includes(word.toLowerCase())) {
        return {
          type: 'BAD_WORDS',
          severity: 'LOW',
          action: 'WARN',
          reason: 'Lenguaje no permitido',
          content: message.content,
        };
      }
    }

    return null;
  }

  private async checkSuspiciousLinks(message: Message): Promise<AutomodViolation | null> {
    const urlRegex = /https?:\/\/[^\s]+/g;
    const urls = message.content.match(urlRegex) ?? [];

    for (const url of urls) {
      // URL shorteners sospechosos
      if (/bit\.ly|tinyurl|t\.co|goo\.gl|is\.gd|ow\.ly/.test(url)) {
        return {
          type: 'SUSPICIOUS_LINK',
          severity: 'LOW',
          action: 'WARN',
          reason: 'Enlace acortado sospechoso detectado',
          content: url,
        };
      }
    }

    return null;
  }

  // ================================
  // CONFIG
  // ================================

  private async getConfig(guildId: string) {
    return cacheWithFallback(
      CacheKeys.automodConfig(guildId),
      () => prisma.automodConfig.findUnique({ where: { guildId } }),
      300
    );
  }
}

// ================================
// INICIALIZACIÓN DEL MÓDULO
// ================================

export async function initAutomod(client: GuardianClient): Promise<void> {
  const engine = new AutomodEngine(client.user?.id ?? '');

  client.on('messageCreate', async (message) => {
    if (!message.guild || message.author.bot) return;

    try {
      const violation = await engine.check(message);
      if (violation) {
        await engine.applyAction(message, violation);
      }
    } catch (error) {
      logger.error('[AutoMod] Error procesando mensaje:', error);
    }
  });

  logger.info('[AutoMod] Motor de automoderación activo');
}
