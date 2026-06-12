/**
 * GUARDIAN BOT - Ticket Service
 * Gestión completa de tickets premium
 */

import {
  Guild,
  CategoryChannel,
  ChannelType,
  PermissionFlagsBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  TextChannel,
  OverwriteType,
  userMention,
  time,
  TimestampStyles,
} from 'discord.js';
import { prisma } from '../database/client';
import { cacheWithFallback, CacheKeys } from '../database/redis';
import { Colors } from '../types';
import { logger } from '../utils/logger';

export class TicketService {

  // ================================
  // CREAR TICKET
  // ================================

  static async createTicket(
    guild: Guild,
    userId: string,
    category: string,
    subject?: string
  ): Promise<{ success: boolean; channelId?: string; error?: string }> {
    try {
      const config = await cacheWithFallback(
        CacheKeys.ticketConfig(guild.id),
        () => prisma.ticketConfig.findUnique({ where: { guildId: guild.id } }),
        300
      );

      if (!config?.enabled) {
        return { success: false, error: 'El sistema de tickets no está habilitado.' };
      }

      // Verificar límite de tickets abiertos por usuario
      const openTickets = await prisma.ticket.count({
        where: {
          guildId: guild.id,
          userId,
          status: { in: ['OPEN', 'CLAIMED'] },
        },
      });

      if (openTickets >= config.maxTickets) {
        return { success: false, error: `Ya tienes ${openTickets} ticket(s) abierto(s). Ciérralos antes de abrir uno nuevo.` };
      }

      // Número de ticket secuencial
      const lastTicket = await prisma.ticket.findFirst({
        where: { guildId: guild.id },
        orderBy: { ticketNumber: 'desc' },
      });
      const ticketNumber = (lastTicket?.ticketNumber ?? 0) + 1;

      // Crear canal
      const categoryChannel = config.categoryId
        ? guild.channels.cache.get(config.categoryId) as CategoryChannel
        : null;

      const member = await guild.members.fetch(userId).catch(() => null);

      const channel = await guild.channels.create({
        name: `ticket-${ticketNumber.toString().padStart(4, '0')}`,
        type: ChannelType.GuildText,
        parent: categoryChannel ?? undefined,
        topic: `Ticket #${ticketNumber} | ${category} | ${userId}`,
        permissionOverwrites: [
          // Ocultar al @everyone
          { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
          // Permitir al usuario
          ...(member ? [{
            id: member.id,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.ReadMessageHistory,
              PermissionFlagsBits.AttachFiles,
              PermissionFlagsBits.EmbedLinks,
            ],
          }] : []),
          // Permitir al staff
          ...config.staffRoleIds.map((roleId) => ({
            id: roleId,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.ReadMessageHistory,
              PermissionFlagsBits.ManageMessages,
              PermissionFlagsBits.AttachFiles,
            ],
          })),
        ],
      });

      // Guardar en BD
      const ticket = await prisma.ticket.create({
        data: {
          ticketNumber,
          guildId: guild.id,
          channelId: channel.id,
          userId,
          category: category as any,
          subject,
          status: 'OPEN',
        },
      });

      // Upsert usuario
      await prisma.user.upsert({
        where: { id: userId },
        update: {},
        create: { id: userId, username: member?.user.username ?? 'Unknown' },
      });

      // Mensaje de bienvenida en el ticket
      const welcomeEmbed = new EmbedBuilder()
        .setColor(Colors.TICKET)
        .setTitle(`🎫 Ticket #${ticketNumber}`)
        .setDescription(
          `Bienvenido ${userMention(userId)}!\n\n` +
          `Tu ticket ha sido creado en la categoría **${category}**.\n` +
          `Un miembro del staff te atenderá pronto.\n\n` +
          (subject ? `**Asunto:** ${subject}` : 'Por favor describe tu consulta.')
        )
        .addFields({ name: '⏰ Abierto', value: time(new Date(), TimestampStyles.RelativeTime) })
        .setTimestamp();

      const controlRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`ticket:claim:${ticket.id}`)
          .setLabel('📋 Reclamar')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(`ticket:close:${ticket.id}`)
          .setLabel('🔒 Cerrar')
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId(`ticket:transcript:${ticket.id}`)
          .setLabel('📄 Transcript')
          .setStyle(ButtonStyle.Secondary),
      );

      await channel.send({
        content: `${userMention(userId)} ${config.staffRoleIds.map((r) => `<@&${r}>`).join(' ')}`,
        embeds: [welcomeEmbed],
        components: [controlRow],
      });

      // Log de apertura
      if (config.logChannelId) {
        const logChannel = guild.channels.cache.get(config.logChannelId) as TextChannel;
        if (logChannel) {
          await logChannel.send({
            embeds: [
              new EmbedBuilder()
                .setColor(Colors.SUCCESS)
                .setTitle('🎫 Nuevo Ticket')
                .addFields(
                  { name: '👤 Usuario', value: userMention(userId), inline: true },
                  { name: '📂 Categoría', value: category, inline: true },
                  { name: '🔢 Número', value: `#${ticketNumber}`, inline: true },
                  { name: '📍 Canal', value: channel.toString() },
                )
                .setTimestamp(),
            ],
          });
        }
      }

      return { success: true, channelId: channel.id };
    } catch (error) {
      logger.error('[TicketService] Error creando ticket:', error);
      return { success: false, error: 'Error interno al crear el ticket.' };
    }
  }

  // ================================
  // CERRAR TICKET
  // ================================

  static async closeTicket(
    guild: Guild,
    ticketId: string,
    closedBy: string,
    reason?: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const ticket = await prisma.ticket.findUnique({ where: { id: ticketId } });
      if (!ticket) return { success: false, error: 'Ticket no encontrado.' };
      if (ticket.status === 'CLOSED') return { success: false, error: 'El ticket ya está cerrado.' };

      // Generar transcript
      await this.generateTranscript(guild, ticket.channelId, ticketId);

      // Actualizar BD
      await prisma.ticket.update({
        where: { id: ticketId },
        data: {
          status: 'CLOSED',
          closedBy,
          closedAt: new Date(),
          closeReason: reason,
        },
      });

      const channel = guild.channels.cache.get(ticket.channelId) as TextChannel;
      if (channel) {
        const embed = new EmbedBuilder()
          .setColor(Colors.ERROR)
          .setTitle('🔒 Ticket Cerrado')
          .addFields(
            { name: '👤 Cerrado por', value: userMention(closedBy), inline: true },
            { name: '⏰ Hora', value: time(new Date(), TimestampStyles.ShortDateTime), inline: true },
          )
          .setTimestamp();

        if (reason) embed.addFields({ name: '📝 Motivo', value: reason });

        const reopenRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId(`ticket:reopen:${ticketId}`)
            .setLabel('🔓 Reabrir')
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId(`ticket:delete:${ticketId}`)
            .setLabel('🗑️ Eliminar canal')
            .setStyle(ButtonStyle.Danger),
        );

        await channel.send({ embeds: [embed], components: [reopenRow] });

        // Revocar acceso al usuario
        await channel.permissionOverwrites.edit(ticket.userId, {
          SendMessages: false,
        }).catch(() => null);

        await channel.setName(`closed-${ticket.ticketNumber.toString().padStart(4, '0')}`).catch(() => null);
      }

      return { success: true };
    } catch (error) {
      logger.error('[TicketService] Error cerrando ticket:', error);
      return { success: false, error: 'Error interno al cerrar el ticket.' };
    }
  }

  // ================================
  // GENERAR TRANSCRIPT
  // ================================

  static async generateTranscript(
    guild: Guild,
    channelId: string,
    ticketId: string
  ): Promise<string | null> {
    try {
      const channel = guild.channels.cache.get(channelId) as TextChannel;
      if (!channel) return null;

      // Obtener mensajes (máx 500)
      const messages = await channel.messages.fetch({ limit: 100 });
      const sortedMessages = [...messages.values()].reverse();

      // Generar HTML
      const html = generateHtmlTranscript(sortedMessages, channel.name);

      // Guardar transcript
      await prisma.ticketTranscript.upsert({
        where: { ticketId },
        update: { htmlContent: html },
        create: { ticketId, htmlContent: html },
      });

      return html;
    } catch (error) {
      logger.error('[TicketService] Error generando transcript:', error);
      return null;
    }
  }
}

// ================================
// HTML TRANSCRIPT GENERATOR
// ================================

function generateHtmlTranscript(messages: any[], channelName: string): string {
  const rows = messages.map((msg) => {
    const time = new Date(msg.createdTimestamp).toLocaleString('es-ES');
    const content = msg.content ? escapeHtml(msg.content) : '<em>Sin contenido</em>';
    const attachments = msg.attachments.size > 0
      ? `<div class="attachments">${[...msg.attachments.values()].map((a: any) =>
          a.contentType?.startsWith('image/')
            ? `<img src="${a.url}" alt="attachment" style="max-width:300px;">`
            : `<a href="${a.url}">${a.name}</a>`
        ).join('')}</div>`
      : '';

    return `
      <div class="message ${msg.author.bot ? 'bot' : ''}">
        <div class="avatar"><img src="${msg.author.displayAvatarURL({ size: 32 })}" alt=""></div>
        <div class="content">
          <div class="header">
            <span class="author" style="color: ${msg.member?.displayHexColor ?? '#fff'}">${escapeHtml(msg.author.tag)}</span>
            <span class="time">${time}</span>
          </div>
          <div class="text">${content}</div>
          ${attachments}
        </div>
      </div>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Transcript: ${channelName}</title>
  <style>
    body { background: #36393f; color: #dcddde; font-family: 'Segoe UI', sans-serif; margin: 0; padding: 20px; }
    h1 { color: #fff; border-bottom: 1px solid #4f545c; padding-bottom: 10px; }
    .message { display: flex; gap: 12px; padding: 4px 0; margin: 2px 0; }
    .message:hover { background: rgba(255,255,255,0.05); border-radius: 4px; }
    .avatar img { width: 40px; height: 40px; border-radius: 50%; }
    .header { display: flex; align-items: baseline; gap: 8px; margin-bottom: 4px; }
    .author { font-weight: 600; }
    .time { font-size: 0.75rem; color: #72767d; }
    .text { line-height: 1.5; }
    .bot .author::after { content: 'BOT'; background: #5865f2; color: white; font-size: 0.65rem; padding: 1px 4px; border-radius: 3px; margin-left: 4px; }
    .attachments { margin-top: 8px; }
    .attachments img { border-radius: 4px; display: block; margin: 4px 0; }
    .attachments a { color: #00b0f4; }
  </style>
</head>
<body>
  <h1>📋 Transcript: #${channelName}</h1>
  <p>Generado: ${new Date().toLocaleString('es-ES')}</p>
  <div class="messages">${rows}</div>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
