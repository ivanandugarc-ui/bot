/**
 * GUARDIAN BOT - Moderation Service
 * Lógica central de moderación: ban, kick, mute, timeout, warn, etc.
 */

import {
  Guild,
  GuildMember,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  TextChannel,
  time,
  TimestampStyles,
} from 'discord.js';
import { prisma } from '../database/client';
import { redis, CacheKeys, cacheDel } from '../database/redis';
import { LogService } from './logService';
import { Colors, type ModerationOptions, type ModerationResult } from '../types';
import { parseDuration, formatDuration } from '../utils/duration';
import { logger } from '../utils/logger';

export class ModerationService {
  private static logService = new LogService();

  // ================================
  // BAN
  // ================================

  static async ban(
    guild: Guild,
    options: ModerationOptions & { deleteMessages?: number }
  ): Promise<ModerationResult> {
    try {
      const target = await guild.members.fetch(options.targetId).catch(() => null);

      if (target && !target.bannable) {
        return { success: false, error: 'No puedo banear a este usuario (permisos superiores).' };
      }

      await guild.members.ban(options.targetId, {
        reason: `[${options.moderatorId}] ${options.reason}`,
        deleteMessageSeconds: (options.deleteMessages ?? 0) * 86400,
      });

      const result = await this.createCase(guild.id, options);
      await this.notifyUser(guild, options.targetId, 'ban', options.reason, options.duration);
      await this.logService.logModeration(guild, { ...options, caseNumber: result.caseNumber });

      return result;
    } catch (error) {
      logger.error('[Moderation] Error en ban:', error);
      return { success: false, error: 'Error al ejecutar el ban.' };
    }
  }

  // ================================
  // TEMPBAN
  // ================================

  static async tempban(
    guild: Guild,
    options: ModerationOptions
  ): Promise<ModerationResult> {
    if (!options.duration) return { success: false, error: 'Duración requerida para tempban.' };

    const result = await this.ban(guild, options);

    if (result.success && options.duration) {
      // Programar unban
      const key = `tempban:${guild.id}:${options.targetId}`;
      await redis.setex(key, options.duration, JSON.stringify({
        guildId: guild.id,
        userId: options.targetId,
        moderatorId: options.moderatorId,
        reason: `Tempban expirado. Razón original: ${options.reason}`,
      }));
    }

    return result;
  }

  // ================================
  // UNBAN
  // ================================

  static async unban(
    guild: Guild,
    options: ModerationOptions
  ): Promise<ModerationResult> {
    try {
      const ban = await guild.bans.fetch(options.targetId).catch(() => null);
      if (!ban) return { success: false, error: 'Este usuario no está baneado.' };

      await guild.members.unban(options.targetId, `[${options.moderatorId}] ${options.reason}`);

      const result = await this.createCase(guild.id, options);
      await this.logService.logModeration(guild, { ...options, caseNumber: result.caseNumber });

      // Actualizar sanción activa
      await prisma.moderation.updateMany({
        where: {
          guildId: guild.id,
          targetId: options.targetId,
          type: { in: ['BAN', 'TEMPBAN'] },
          status: 'ACTIVE',
        },
        data: { status: 'REVOKED' },
      });

      return result;
    } catch (error) {
      logger.error('[Moderation] Error en unban:', error);
      return { success: false, error: 'Error al ejecutar el unban.' };
    }
  }

  // ================================
  // KICK
  // ================================

  static async kick(
    guild: Guild,
    options: ModerationOptions
  ): Promise<ModerationResult> {
    try {
      const member = await guild.members.fetch(options.targetId).catch(() => null);
      if (!member) return { success: false, error: 'Usuario no encontrado en el servidor.' };
      if (!member.kickable) return { success: false, error: 'No puedo expulsar a este usuario.' };

      await this.notifyUser(guild, options.targetId, 'kick', options.reason);
      await member.kick(`[${options.moderatorId}] ${options.reason}`);

      const result = await this.createCase(guild.id, options);
      await this.logService.logModeration(guild, { ...options, caseNumber: result.caseNumber });

      return result;
    } catch (error) {
      logger.error('[Moderation] Error en kick:', error);
      return { success: false, error: 'Error al ejecutar el kick.' };
    }
  }

  // ================================
  // TIMEOUT
  // ================================

  static async timeout(
    guild: Guild,
    options: ModerationOptions
  ): Promise<ModerationResult> {
    try {
      if (!options.duration) return { success: false, error: 'Duración requerida para timeout.' };
      if (options.duration > 2419200) return { success: false, error: 'El timeout no puede ser mayor a 28 días.' };

      const member = await guild.members.fetch(options.targetId).catch(() => null);
      if (!member) return { success: false, error: 'Usuario no encontrado.' };
      if (!member.moderatable) return { success: false, error: 'No puedo silenciar a este usuario.' };

      await member.timeout(options.duration * 1000, `[${options.moderatorId}] ${options.reason}`);
      await this.notifyUser(guild, options.targetId, 'timeout', options.reason, options.duration);

      const result = await this.createCase(guild.id, options);
      await this.logService.logModeration(guild, { ...options, caseNumber: result.caseNumber });

      return result;
    } catch (error) {
      logger.error('[Moderation] Error en timeout:', error);
      return { success: false, error: 'Error al aplicar timeout.' };
    }
  }

  // ================================
  // REMOVE TIMEOUT
  // ================================

  static async untimeout(
    guild: Guild,
    options: ModerationOptions
  ): Promise<ModerationResult> {
    try {
      const member = await guild.members.fetch(options.targetId).catch(() => null);
      if (!member) return { success: false, error: 'Usuario no encontrado.' };

      await member.timeout(null, `[${options.moderatorId}] ${options.reason}`);

      const result = await this.createCase(guild.id, options);
      await this.logService.logModeration(guild, { ...options, caseNumber: result.caseNumber });

      return result;
    } catch (error) {
      logger.error('[Moderation] Error en untimeout:', error);
      return { success: false, error: 'Error al remover timeout.' };
    }
  }

  // ================================
  // WARN
  // ================================

  static async warn(
    guild: Guild,
    options: ModerationOptions & { points?: number }
  ): Promise<ModerationResult> {
    try {
      const member = await guild.members.fetch(options.targetId).catch(() => null);
      if (!member) return { success: false, error: 'Usuario no encontrado.' };

      await prisma.warning.create({
        data: {
          guildId: guild.id,
          userId: options.targetId,
          moderatorId: options.moderatorId,
          reason: options.reason,
          points: options.points ?? 1,
        },
      });

      // Invalidar caché de advertencias
      await cacheDel(CacheKeys.userWarnings(guild.id, options.targetId));

      // Contar advertencias activas
      const totalWarnings = await prisma.warning.count({
        where: { guildId: guild.id, userId: options.targetId, active: true },
      });

      await this.notifyUser(guild, options.targetId, 'warn', options.reason);

      const result = await this.createCase(guild.id, options);
      await this.logService.logModeration(guild, {
        ...options,
        caseNumber: result.caseNumber,
        metadata: { totalWarnings },
      });

      // Acciones automáticas por acumulación de warns
      await this.checkAutoAction(guild, options.targetId, totalWarnings, options.moderatorId);

      return { ...result, metadata: { totalWarnings } } as ModerationResult & { metadata: { totalWarnings: number } };
    } catch (error) {
      logger.error('[Moderation] Error en warn:', error);
      return { success: false, error: 'Error al aplicar advertencia.' };
    }
  }

  // ================================
  // PRIVATE HELPERS
  // ================================

  /**
   * Crea un caso de moderación en la base de datos
   */
  private static async createCase(
    guildId: string,
    options: ModerationOptions
  ): Promise<ModerationResult> {
    try {
      // Asegurar que el guild existe en BD
      await prisma.guild.upsert({
        where: { id: guildId },
        update: {},
        create: { id: guildId, name: 'Unknown', ownerId: 'Unknown' },
      });

      // Asegurar usuarios en BD
      await prisma.user.upsert({
        where: { id: options.targetId },
        update: {},
        create: { id: options.targetId, username: 'Unknown' },
      });
      await prisma.user.upsert({
        where: { id: options.moderatorId },
        update: {},
        create: { id: options.moderatorId, username: 'Unknown' },
      });

      // Número de caso (secuencial por guild)
      const lastCase = await prisma.moderationCase.findFirst({
        where: { guildId },
        orderBy: { caseNumber: 'desc' },
      });
      const caseNumber = (lastCase?.caseNumber ?? 0) + 1;

      const expiresAt = options.duration
        ? new Date(Date.now() + options.duration * 1000)
        : undefined;

      const moderation = await prisma.moderation.create({
        data: {
          guildId,
          targetId: options.targetId,
          moderatorId: options.moderatorId,
          type: options.action as any,
          reason: options.reason,
          duration: options.duration,
          expiresAt,
          evidence: options.evidence ?? [],
          metadata: options.metadata as any,
        },
      });

      const caseRecord = await prisma.moderationCase.create({
        data: {
          caseNumber,
          guildId,
          moderationId: moderation.id,
          targetId: options.targetId,
          moderatorId: options.moderatorId,
          type: options.action as any,
          reason: options.reason,
          evidence: options.evidence ?? [],
        },
      });

      return { success: true, caseId: caseRecord.id, caseNumber };
    } catch (error) {
      logger.error('[Moderation] Error creando caso:', error);
      return { success: false, error: 'Error al crear el caso.' };
    }
  }

  /**
   * Notifica al usuario por DM sobre la sanción
   */
  private static async notifyUser(
    guild: Guild,
    userId: string,
    action: string,
    reason: string,
    duration?: number
  ): Promise<void> {
    try {
      const user = await guild.client.users.fetch(userId).catch(() => null);
      if (!user) return;

      const actionNames: Record<string, string> = {
        ban: '🔨 Has sido baneado',
        kick: '👢 Has sido expulsado',
        mute: '🔇 Has sido silenciado',
        timeout: '⏰ Has recibido un timeout',
        warn: '⚠️ Has recibido una advertencia',
      };

      const embed = new EmbedBuilder()
        .setColor(Colors.ERROR)
        .setTitle(`${actionNames[action] ?? '⚠️ Sanción'} en **${guild.name}**`)
        .addFields({ name: 'Razón', value: reason })
        .setTimestamp();

      if (duration) {
        embed.addFields({
          name: 'Duración',
          value: formatDuration(duration),
        });
      }

      embed.addFields({
        name: '¿Injusto?',
        value: 'Puedes apelar esta sanción si crees que es incorrecta.',
      });

      await user.send({ embeds: [embed] }).catch(() => null);
    } catch {
      // Ignorar si no se puede enviar DM
    }
  }

  /**
   * Acciones automáticas basadas en número de advertencias
   */
  private static async checkAutoAction(
    guild: Guild,
    targetId: string,
    totalWarnings: number,
    moderatorId: string
  ): Promise<void> {
    // Ejemplo: 3 warns = timeout, 5 warns = kick, 7 warns = ban
    // Esto debería ser configurable por guild
    const thresholds = [
      { at: 3, action: 'TIMEOUT', duration: 3600 },
      { at: 5, action: 'KICK', duration: undefined },
      { at: 7, action: 'BAN', duration: undefined },
    ];

    const threshold = thresholds.find((t) => t.at === totalWarnings);
    if (!threshold) return;

    logger.info(`[AutoAction] ${totalWarnings} warns → ${threshold.action} para ${targetId} en ${guild.id}`);

    switch (threshold.action) {
      case 'TIMEOUT':
        await this.timeout(guild, {
          guildId: guild.id,
          targetId,
          moderatorId,
          action: 'TIMEOUT',
          reason: `Acción automática: ${totalWarnings} advertencias acumuladas`,
          duration: threshold.duration,
        });
        break;
      case 'KICK':
        await this.kick(guild, {
          guildId: guild.id,
          targetId,
          moderatorId,
          action: 'KICK',
          reason: `Acción automática: ${totalWarnings} advertencias acumuladas`,
        });
        break;
      case 'BAN':
        await this.ban(guild, {
          guildId: guild.id,
          targetId,
          moderatorId,
          action: 'BAN',
          reason: `Acción automática: ${totalWarnings} advertencias acumuladas`,
        });
        break;
    }
  }
}
