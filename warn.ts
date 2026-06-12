/**
 * GUARDIAN BOT - /warn Command
 */

import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  userMention,
} from 'discord.js';
import { ModerationService } from '../../services/moderationService';
import { Colors, type Command } from '../../types';
import { prisma } from '../../database/client';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('warn')
    .setDescription('Advierte a un usuario')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption((opt) =>
      opt.setName('usuario').setDescription('Usuario a advertir').setRequired(true)
    )
    .addStringOption((opt) =>
      opt.setName('razon').setDescription('Razón de la advertencia').setRequired(true).setMaxLength(512)
    )
    .addIntegerOption((opt) =>
      opt.setName('puntos').setDescription('Puntos de la advertencia (1-5)').setMinValue(1).setMaxValue(5)
    ),

  category: 'moderation',
  permissions: [PermissionFlagsBits.ModerateMembers],
  guildOnly: true,

  async execute(interaction) {
    const target = interaction.options.getUser('usuario', true);
    const reason = interaction.options.getString('razon', true);
    const points = interaction.options.getInteger('puntos') ?? 1;

    if (!interaction.guild) return;

    await interaction.deferReply({ ephemeral: true });

    const result = await ModerationService.warn(interaction.guild, {
      guildId: interaction.guild.id,
      targetId: target.id,
      moderatorId: interaction.user.id,
      action: 'WARN',
      reason,
      points,
    });

    if (!result.success) {
      await interaction.editReply({
        embeds: [new EmbedBuilder().setColor(Colors.ERROR).setDescription(`❌ ${result.error}`)],
      });
      return;
    }

    // Obtener total de warns
    const totalWarnings = await prisma.warning.count({
      where: { guildId: interaction.guild.id, userId: target.id, active: true },
    });

    const embed = new EmbedBuilder()
      .setColor(Colors.MOD)
      .setTitle('⚠️ Advertencia Emitida')
      .addFields(
        { name: '👤 Usuario', value: `${target.tag} (${userMention(target.id)})`, inline: true },
        { name: '🆔 Caso', value: `#${result.caseNumber}`, inline: true },
        { name: '📝 Razón', value: reason },
        { name: '📊 Total advertencias', value: `${totalWarnings} activa${totalWarnings !== 1 ? 's' : ''}`, inline: true },
        { name: '⚡ Puntos añadidos', value: points.toString(), inline: true },
      )
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  },
};

export default command;
