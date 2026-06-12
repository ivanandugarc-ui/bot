/**
 * GUARDIAN BOT - AntiRaid System
 * Sistema de protección contra raids masivos
 */

import {
  Guild,
  GuildMember,
  GuildChannel,
  Role,
  EmbedBuilder,
  TextChannel,
  PermissionFlagsBits,
  ChannelType,
  AuditLogEvent,
  time,
  TimestampStyles,
  userMention,
} from 'discord.js';
import { prisma } from '../database/client';
import { redis, cacheWithFallback, CacheKeys, incrementCounter } from '../database/redis';
import { ModerationService } from '../services/moderationService';
import { Colors } from '../types';
import { logger } from '../utils/logger';
import type { GuardianClient } from '../bot';

interface RaidEntry {
  userId: string;
  timestamp: number;
}

export class AntiRaidSystem {
  private joinQueue: Map<string, RaidEntry[]> = new Map();

  // ================================
  // DETECTAR RAID POR JOINS
  // ================================

  async onMemberJoin(guild: Guild, member: GuildMember): Promise<void> {
    const config = await this.getConfig(guild.id);
    if (!config?.enabled) return;

    const guildId = guild.id;
    const now = Date.now();
    const windowMs = (config.joinThresholdTime ?? 10) * 1000;
    const threshold = config.joinThreshold ?? 10;

    // Mantener queue de joins recientes
    if (!this.joinQueue.has(guildId)) this.joinQueue.set(guildId, []);
    const queue = this.joinQueue.get(guildId)!;

    // Filtrar entradas fuera de la ventana de tiempo
    const recent = queue.filter((e) => now - e.timestamp < windowMs);
    recent.push({ userId: member.id, timestamp: now });
    this.joinQueue.set(guildId, recent);

    // Usar también Redis para persistencia cross-shard
    const raidKey = CacheKeys.raidDetection(guildId);
    const raidCount = await incrementCounter(raidKey, config.joinThresholdTime ?? 10);

    if (raidCount >= threshold) {
      logger.warn(`[AntiRaid] Raid detectado en ${guild.name}: ${raidCount} joins en ${config.joinThresholdTime}s`);
      await this.activateLockdown(guild, config, recent.map((e) => e.userId));
    }
  }

  // ================================
  // DETECTAR ACCIONES MASIVAS
  // ================================

  async onChannelCreate(guild: Guild, _channel: GuildChannel): Promise<void> {
    const config = await this.getConfig(guild.id);
    if (!config?.enabled) return;

    const count = await incrementCounter(`antiraid_ch_create:${guild.id}`, 60);
    if (count >= (config.channelCreateThreshold ?? 5)) {
      await this.activateLockdown(guild, config, [], 'Creación masiva de canales detectada');
    }
  }

  async onChannelDelete(guild: Guild, _channel: GuildChannel): Promise<void> {
    const config = await this.getConfig(guild.id);
    if (!config?.enabled) return;

    const count = await incrementCounter(`antiraid_ch_delete:${guild.id}`, 60);
    if (count >= (config.deleteThreshold ?? 10)) {
      await this.activateLockdown(guild, config, [], 'Eliminación masiva de canales detectada');
    }
  }

  async onRoleCreate(guild: Guild, _role: Role): Promise<void> {
    const config = await this.getConfig(guild.id);
    if (!config?.enabled) return;

    const count = await incrementCounter(`antiraid_role_create:${guild.id}`, 60);
    if (count >= (config.roleCreateThreshold ?? 5)) {
      await this.activateLockdown(guild, config, [], 'Creación masiva de roles detectada');
    }
  }

  // ================================
  // ACTIVAR LOCKDOWN
  // ================================

  async activateLockdown(
    guild: Guild,
    config: NonNullable<Awaited<ReturnType<AntiRaidSystem['getConfig']>>>,
    suspectedUserIds: string[] = [],
    reason: string = 'Raid detectado'
  ): Promise<void> {
    if (config.lockdownActive) return; // Ya está en lockdown

    logger.warn(`[AntiRaid] Iniciando lockdown en ${guild.name}: ${reason}`);

    // Actualizar BD
    await prisma.antiRaidConfig.update({
      where: { guildId: guild.id },
      data: { lockdownActive: true, lockdownAt: new Date() },
    });

    const actions: Promise<unknown>[] = [];

    // 1. Bloquear canales de texto
    if (config.autoLockdown) {
      const textChannels = guild.channels.cache.filter(
        (c) => c.type === ChannelType.GuildText && c.permissionsFor(guild.roles.everyone)?.has(PermissionFlagsBits.SendMessages)
      );

      for (const [, channel] of textChannels.entries()) {
        actions.push(
          (channel as TextChannel).permissionOverwrites
            .edit(guild.roles.everyone, { SendMessages: false })
            .catch(() => null)
        );
      }
    }

    await Promise.all(actions);

    // 2. Kickear usuarios sospechosos
    if (config.autoKickSuspected && suspectedUserIds.length > 0) {
      for (const userId of suspectedUserIds) {
        const member = guild.members.cache.get(userId);
        if (member?.kickable) {
          await member.kick(`[AntiRaid] Expulsado durante lockdown: ${reason}`).catch(() => null);
        }
      }
    }

    // 3. Notificar al canal de alertas
    if (config.alertChannelId) {
      const alertChannel = guild.channels.cache.get(config.alertChannelId) as TextChannel;
      if (alertChannel) {
        const embed = new EmbedBuilder()
          .setColor(Colors.ERROR)
          .setTitle('🚨 LOCKDOWN ACTIVADO')
          .setDescription(`**Razón:** ${reason}`)
          .addFields(
            { name: '📊 Usuarios sospechosos', value: suspectedUserIds.length.toString(), inline: true },
            { name: '⏰ Hora', value: time(new Date(), TimestampStyles.LongDateTime), inline: true },
          )
          .setTimestamp();

        const mentionContent = config.alertRoleId ? `<@&${config.alertRoleId}>` : '';

        await alertChannel.send({
          content: `🚨 **LOCKDOWN ACTIVADO** ${mentionContent}`,
          embeds: [embed],
        }).catch(() => null);
      }
    }

    logger.warn(`[AntiRaid] Lockdown activo en ${guild.name}`);
  }

  // ================================
  // DESACTIVAR LOCKDOWN
  // ================================

  async deactivateLockdown(guild: Guild, moderatorId: string): Promise<boolean> {
    const config = await this.getConfig(guild.id);
    if (!config?.lockdownActive) return false;

    // Restaurar permisos de canales
    const textChannels = guild.channels.cache.filter((c) => c.type === ChannelType.GuildText);

    for (const [, channel] of textChannels.entries()) {
      await (channel as TextChannel).permissionOverwrites
        .edit(guild.roles.everyone, { SendMessages: null })
        .catch(() => null);
    }

    // Actualizar BD
    await prisma.antiRaidConfig.update({
      where: { guildId: guild.id },
      data: { lockdownActive: false, lockdownAt: null },
    });

    if (config.alertChannelId) {
      const alertChannel = guild.channels.cache.get(config.alertChannelId) as TextChannel;
      if (alertChannel) {
        await alertChannel.send({
          embeds: [
            new EmbedBuilder()
              .setColor(Colors.SUCCESS)
              .setTitle('✅ Lockdown Desactivado')
              .addFields({ name: '👤 Desactivado por', value: userMention(moderatorId) })
              .setTimestamp(),
          ],
        }).catch(() => null);
      }
    }

    return true;
  }

  private async getConfig(guildId: string) {
    return cacheWithFallback(
      CacheKeys.antiRaidConfig(guildId),
      () => prisma.antiRaidConfig.findUnique({ where: { guildId } }),
      300
    );
  }
}

// ================================
// INICIALIZACIÓN
// ================================

export async function initAntiRaid(client: GuardianClient): Promise<void> {
  const system = new AntiRaidSystem();

  client.on('guildMemberAdd', async (member) => {
    try {
      await system.onMemberJoin(member.guild, member);
    } catch (error) {
      logger.error('[AntiRaid] Error en guildMemberAdd:', error);
    }
  });

  client.on('channelCreate', async (channel) => {
    if (!channel.guild) return;
    try {
      await system.onChannelCreate(channel.guild, channel as GuildChannel);
    } catch (error) {
      logger.error('[AntiRaid] Error en channelCreate:', error);
    }
  });

  client.on('channelDelete', async (channel) => {
    if (!('guild' in channel) || !channel.guild) return;
    try {
      await system.onChannelDelete(channel.guild, channel as GuildChannel);
    } catch (error) {
      logger.error('[AntiRaid] Error en channelDelete:', error);
    }
  });

  client.on('roleCreate', async (role) => {
    try {
      await system.onRoleCreate(role.guild, role);
    } catch (error) {
      logger.error('[AntiRaid] Error en roleCreate:', error);
    }
  });

  logger.info('[AntiRaid] Sistema antiraid activo');
}
