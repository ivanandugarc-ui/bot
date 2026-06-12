/**
 * GUARDIAN BOT - /ban Command
 */

import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  userMention,
} from 'discord.js';
import { ModerationService } from '../../services/moderationService';
import { Colors, type Command } from '../../types';
import { parseDuration } from '../../utils/duration';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Banea permanentemente a un usuario del servidor')
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addUserOption((opt) =>
      opt.setName('usuario').setDescription('Usuario a banear').setRequired(true)
    )
    .addStringOption((opt) =>
      opt.setName('razon').setDescription('Razón del ban').setRequired(true).setMaxLength(512)
    )
    .addIntegerOption((opt) =>
      opt.setName('mensajes').setDescription('Días de mensajes a eliminar (0-7)').setMinValue(0).setMaxValue(7)
    )
    .addStringOption((opt) =>
      opt.setName('evidencia').setDescription('URL de evidencia').setRequired(false)
    ),

  category: 'moderation',
  permissions: [PermissionFlagsBits.BanMembers],
  botPermissions: [PermissionFlagsBits.BanMembers],
  guildOnly: true,

  async execute(interaction) {
    const target = interaction.options.getUser('usuario', true);
    const reason = interaction.options.getString('razon', true);
    const deleteMessages = interaction.options.getInteger('mensajes') ?? 0;
    const evidence = interaction.options.getString('evidencia');

    if (!interaction.guild) return;

    // No se puede banear a uno mismo
    if (target.id === interaction.user.id) {
      await interaction.reply({
        embeds: [new EmbedBuilder().setColor(Colors.ERROR).setDescription('❌ No puedes banearte a ti mismo.')],
        ephemeral: true,
      });
      return;
    }

    // No banear al bot
    if (target.id === interaction.client.user?.id) {
      await interaction.reply({
        embeds: [new EmbedBuilder().setColor(Colors.ERROR).setDescription('❌ No me puedes banear.')],
        ephemeral: true,
      });
      return;
    }

    // Confirmación
    const confirmEmbed = new EmbedBuilder()
      .setColor(Colors.WARNING)
      .setTitle('🔨 Confirmar Ban')
      .setThumbnail(target.displayAvatarURL())
      .addFields(
        { name: '👤 Usuario', value: `${target.tag} (${userMention(target.id)})`, inline: true },
        { name: '📝 Razón', value: reason },
        { name: '🗑️ Mensajes a borrar', value: `${deleteMessages} días`, inline: true },
      )
      .setFooter({ text: 'Esta acción es irreversible sin usar /unban' })
      .setTimestamp();

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId('ban_confirm').setLabel('✅ Confirmar').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('ban_cancel').setLabel('❌ Cancelar').setStyle(ButtonStyle.Secondary)
    );

    const reply = await interaction.reply({
      embeds: [confirmEmbed],
      components: [row],
      ephemeral: true,
    });

    const collector = reply.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: 30_000,
      filter: (i) => i.user.id === interaction.user.id,
    });

    collector.on('collect', async (btnInteraction) => {
      collector.stop();

      if (btnInteraction.customId === 'ban_cancel') {
        await btnInteraction.update({
          embeds: [new EmbedBuilder().setColor(Colors.MUTED).setDescription('❌ Ban cancelado.')],
          components: [],
        });
        return;
      }

      await btnInteraction.update({
        embeds: [new EmbedBuilder().setColor(Colors.INFO).setDescription('⏳ Ejecutando ban...')],
        components: [],
      });

      const result = await ModerationService.ban(interaction.guild!, {
        guildId: interaction.guild!.id,
        targetId: target.id,
        moderatorId: interaction.user.id,
        action: 'BAN',
        reason,
        deleteMessages,
        evidence: evidence ? [evidence] : [],
      });

      if (!result.success) {
        await btnInteraction.editReply({
          embeds: [new EmbedBuilder().setColor(Colors.ERROR).setDescription(`❌ ${result.error}`)],
        });
        return;
      }

      const successEmbed = new EmbedBuilder()
        .setColor(Colors.SUCCESS)
        .setTitle('🔨 Usuario Baneado')
        .addFields(
          { name: '👤 Usuario', value: `${target.tag} (${userMention(target.id)})`, inline: true },
          { name: '📝 Razón', value: reason },
          { name: '🆔 Caso', value: `#${result.caseNumber}`, inline: true },
        )
        .setTimestamp();

      await btnInteraction.editReply({ embeds: [successEmbed] });
    });

    collector.on('end', async (_, reason) => {
      if (reason === 'time') {
        await interaction.editReply({
          embeds: [new EmbedBuilder().setColor(Colors.MUTED).setDescription('⏱️ Tiempo de confirmación agotado.')],
          components: [],
        }).catch(() => null);
      }
    });
  },
};

export default command;
