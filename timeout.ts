/**
 * GUARDIAN BOT - /timeout Command
 */

import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  userMention,
} from 'discord.js';
import { ModerationService } from '../../services/moderationService';
import { Colors, type Command } from '../../types';
import { parseDuration, validateDuration } from '../../utils/duration';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('timeout')
    .setDescription('Aplica un timeout (silencio temporal) a un usuario')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption((opt) =>
      opt.setName('usuario').setDescription('Usuario').setRequired(true)
    )
    .addStringOption((opt) =>
      opt.setName('duracion').setDescription('Duración: 10m, 1h, 1d (máx 28d)').setRequired(true)
    )
    .addStringOption((opt) =>
      opt.setName('razon').setDescription('Razón').setRequired(true).setMaxLength(512)
    ),

  category: 'moderation',
  permissions: [PermissionFlagsBits.ModerateMembers],
  botPermissions: [PermissionFlagsBits.ModerateMembers],
  guildOnly: true,

  async execute(interaction) {
    const target = interaction.options.getUser('usuario', true);
    const durationStr = interaction.options.getString('duracion', true);
    const reason = interaction.options.getString('razon', true);

    if (!interaction.guild) return;

    const parsed = parseDuration(durationStr);
    if (!parsed) {
      await interaction.reply({
        embeds: [new EmbedBuilder().setColor(Colors.ERROR).setDescription('❌ Duración inválida. Ejemplo: `10m`, `1h`, `7d`')],
        ephemeral: true,
      });
      return;
    }

    const validationError = validateDuration(parsed.seconds, 2419200); // 28 días
    if (validationError) {
      await interaction.reply({
        embeds: [new EmbedBuilder().setColor(Colors.ERROR).setDescription(`❌ ${validationError}`)],
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply({ ephemeral: true });

    const result = await ModerationService.timeout(interaction.guild, {
      guildId: interaction.guild.id,
      targetId: target.id,
      moderatorId: interaction.user.id,
      action: 'TIMEOUT',
      reason,
      duration: parsed.seconds,
    });

    if (!result.success) {
      await interaction.editReply({
        embeds: [new EmbedBuilder().setColor(Colors.ERROR).setDescription(`❌ ${result.error}`)],
      });
      return;
    }

    const embed = new EmbedBuilder()
      .setColor(Colors.WARNING)
      .setTitle('⏰ Timeout Aplicado')
      .addFields(
        { name: '👤 Usuario', value: `${target.tag} (${userMention(target.id)})`, inline: true },
        { name: '⏱️ Duración', value: parsed.formatted, inline: true },
        { name: '🆔 Caso', value: `#${result.caseNumber}`, inline: true },
        { name: '📝 Razón', value: reason },
      )
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  },
};

export default command;
