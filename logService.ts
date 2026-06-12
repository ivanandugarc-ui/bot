/**
 * GUARDIAN BOT - Log Service
 * Registro de acciones en canales de log con embeds profesionales
 */

import {
  Guild,
  EmbedBuilder,
  TextChannel,
  AuditLogEvent,
  User,
  GuildMember,
  Message,
  GuildChannel,
  Role,
  time,
  TimestampStyles,
  userMention,
  channelMention,
  roleMention,
} from 'discord.js';
import { prisma } from '../database/client';
import { cacheWithFallback, CacheKeys } from '../database/redis';
import { Colors, type ModerationOptions } from '../types';
import { formatDuration } from '../utils/duration';
import { logger } from '../utils/logger';

export class LogService {

  // ================================
  // GET LOG CHANNEL
  // ================================

  private async getLogChannel(
    guild: Guild,
    type: 'moderation' | 'message' | 'member' | 'channel' | 'role' | 'server' | 'ticket'
  ): Promise<TextChannel | null> {
    const config = await cacheWithFallback(
      CacheKeys.logConfig(guild.id),
      () => prisma.logConfig.findUnique({ where: { guildId: guild.id } }),
      300
    );

    if (!config?.enabled) return null;

    const channelId = config[`${type}Channel` as keyof typeof config] as string | null;
    if (!channelId) return null;

    const channel = guild.channels.cache.get(channelId);
    if (!channel?.isTextBased()) return null;

    return channel as TextChannel;
  }

  private async send(channel: TextChannel | null, embed: EmbedBuilder): Promise<void> {
    if (!channel) return;
    try {
      await channel.send({ embeds: [embed] });
    } catch (error) {
      logger.error('[LogService] Error enviando log:', error);
    }
  }

  // ================================
  // LOG MODERATION
  // ================================

  async logModeration(
    guild: Guild,
    options: ModerationOptions & { caseNumber?: number; metadata?: Record<string, unknown> }
  ): Promise<void> {
    const channel = await this.getLogChannel(guild, 'moderation');
    if (!channel) return;

    const actionIcons: Record<string, string> = {
      BAN: '🔨', TEMPBAN: '⏳🔨', UNBAN: '✅', KICK: '👢',
      MUTE: '🔇', TEMPMUTE: '⏳🔇', UNMUTE: '🔊',
      TIMEOUT: '⏰', UNTIMEOUT: '✅⏰', WARN: '⚠️',
      REMOVEWARN: '✅⚠️', NOTE: '📝',
    };

    const actionColors: Record<string, number> = {
      BAN: Colors.ERROR, TEMPBAN: Colors.ERROR, UNBAN: Colors.SUCCESS,
      KICK: Colors.WARNING, MUTE: Colors.WARNING, TEMPMUTE: Colors.WARNING,
      UNMUTE: Colors.SUCCESS, TIMEOUT: Colors.WARNING, UNTIMEOUT: Colors.SUCCESS,
      WARN: Colors.MOD, REMOVEWARN: Colors.SUCCESS, NOTE: Colors.INFO,
    };

    const icon = actionIcons[options.action] ?? '⚙️';
    const color = actionColors[options.action] ?? Colors.MUTED;

    const embed = new EmbedBuilder()
      .setColor(color)
      .setTitle(`${icon} ${options.action}${options.caseNumber ? ` | Caso #${options.caseNumber}` : ''}`)
      .addFields(
        { name: '👤 Usuario', value: userMention(options.targetId), inline: true },
        { name: '🛡️ Moderador', value: userMention(options.moderatorId), inline: true },
        { name: '📝 Razón', value: options.reason },
      )
      .setTimestamp();

    if (options.duration) {
      embed.addFields({ name: '⏱️ Duración', value: formatDuration(options.duration), inline: true });
    }

    if (options.evidence?.length) {
      embed.addFields({ name: '🔗 Evidencias', value: options.evidence.join('\n') });
    }

    if (options.caseNumber) {
      embed.setFooter({ text: `ID de caso: ${options.caseNumber}` });
    }

    await this.send(channel, embed);
  }

  // ================================
  // LOG MESSAGE DELETE
  // ================================

  async logMessageDelete(guild: Guild, message: Message): Promise<void> {
    const channel = await this.getLogChannel(guild, 'message');
    if (!channel) return;

    const embed = new EmbedBuilder()
      .setColor(Colors.ERROR)
      .setTitle('🗑️ Mensaje Eliminado')
      .addFields(
        { name: '👤 Autor', value: message.author ? userMention(message.author.id) : 'Desconocido', inline: true },
        { name: '📍 Canal', value: channelMention(message.channelId), inline: true },
      )
      .setTimestamp();

    if (message.content) {
      embed.addFields({
        name: '💬 Contenido',
        value: message.content.slice(0, 1024) || '*(sin texto)*',
      });
    }

    if (message.attachments.size > 0) {
      embed.addFields({
        name: '📎 Archivos',
        value: message.attachments.map((a) => a.url).join('\n'),
      });
    }

    await this.send(channel, embed);
  }

  // ================================
  // LOG MESSAGE EDIT
  // ================================

  async logMessageEdit(guild: Guild, oldMessage: Message, newMessage: Message): Promise<void> {
    if (oldMessage.content === newMessage.content) return;

    const channel = await this.getLogChannel(guild, 'message');
    if (!channel) return;

    const embed = new EmbedBuilder()
      .setColor(Colors.WARNING)
      .setTitle('✏️ Mensaje Editado')
      .setURL(newMessage.url)
      .addFields(
        { name: '👤 Autor', value: newMessage.author ? userMention(newMessage.author.id) : 'Desconocido', inline: true },
        { name: '📍 Canal', value: channelMention(newMessage.channelId), inline: true },
        { name: '📝 Antes', value: oldMessage.content?.slice(0, 512) || '*(vacío)*' },
        { name: '📝 Después', value: newMessage.content?.slice(0, 512) || '*(vacío)*' },
      )
      .setTimestamp();

    await this.send(channel, embed);
  }

  // ================================
  // LOG MEMBER JOIN
  // ================================

  async logMemberJoin(guild: Guild, member: GuildMember): Promise<void> {
    const channel = await this.getLogChannel(guild, 'member');
    if (!channel) return;

    const accountAge = Date.now() - member.user.createdTimestamp;
    const isNew = accountAge < 7 * 24 * 60 * 60 * 1000; // < 7 días

    const embed = new EmbedBuilder()
      .setColor(Colors.SUCCESS)
      .setTitle('📥 Miembro Entró')
      .setThumbnail(member.user.displayAvatarURL())
      .addFields(
        { name: '👤 Usuario', value: `${member.user.tag} (${userMention(member.id)})`, inline: true },
        { name: '🆔 ID', value: member.id, inline: true },
        { name: '📅 Cuenta creada', value: time(member.user.createdAt, TimestampStyles.RelativeTime), inline: true },
        { name: '👥 Miembros totales', value: guild.memberCount.toString(), inline: true },
      )
      .setTimestamp();

    if (isNew) {
      embed.addFields({ name: '⚠️ Cuenta nueva', value: 'Esta cuenta tiene menos de 7 días de antigüedad.' });
      embed.setColor(Colors.WARNING);
    }

    await this.send(channel, embed);
  }

  // ================================
  // LOG MEMBER LEAVE
  // ================================

  async logMemberLeave(guild: Guild, member: GuildMember): Promise<void> {
    const channel = await this.getLogChannel(guild, 'member');
    if (!channel) return;

    const joinDate = member.joinedAt ? time(member.joinedAt, TimestampStyles.RelativeTime) : 'Desconocido';

    const embed = new EmbedBuilder()
      .setColor(Colors.ERROR)
      .setTitle('📤 Miembro Salió')
      .setThumbnail(member.user.displayAvatarURL())
      .addFields(
        { name: '👤 Usuario', value: `${member.user.tag} (${userMention(member.id)})`, inline: true },
        { name: '🆔 ID', value: member.id, inline: true },
        { name: '📅 Se unió', value: joinDate, inline: true },
        { name: '🏷️ Roles', value: member.roles.cache.filter((r) => r.id !== guild.id).map((r) => r.name).join(', ') || 'Ninguno' },
      )
      .setTimestamp();

    await this.send(channel, embed);
  }

  // ================================
  // LOG CHANNEL CREATE/DELETE
  // ================================

  async logChannelCreate(guild: Guild, channel: GuildChannel): Promise<void> {
    const logChannel = await this.getLogChannel(guild, 'channel');
    if (!logChannel) return;

    const embed = new EmbedBuilder()
      .setColor(Colors.SUCCESS)
      .setTitle('➕ Canal Creado')
      .addFields(
        { name: '📍 Canal', value: `${channel.name} (${channelMention(channel.id)})`, inline: true },
        { name: '📂 Tipo', value: channel.type.toString(), inline: true },
      )
      .setTimestamp();

    await this.send(logChannel, embed);
  }

  async logChannelDelete(guild: Guild, channel: GuildChannel): Promise<void> {
    const logChannel = await this.getLogChannel(guild, 'channel');
    if (!logChannel) return;

    const embed = new EmbedBuilder()
      .setColor(Colors.ERROR)
      .setTitle('❌ Canal Eliminado')
      .addFields(
        { name: '📍 Canal', value: channel.name, inline: true },
        { name: '🆔 ID', value: channel.id, inline: true },
      )
      .setTimestamp();

    await this.send(logChannel, embed);
  }
}
