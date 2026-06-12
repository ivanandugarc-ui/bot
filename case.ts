/**
 * GUARDIAN BOT - /case Command
 * Ver y gestionar casos de moderación
 */

import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  userMention,
  time,
  TimestampStyles,
} from 'discord.js';
import { prisma } from '../../database/client';
import { Colors, type Command } from '../../types';
import { formatDuration } from '../../utils/duration';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('case')
    .setDescription('Ver o editar un caso de moderación')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addSubcommand((sub) =>
      sub.setName('ver').setDescription('Ver un caso específico')
        .addIntegerOption((opt) => opt.setName('numero').setDescription('Número del caso').setRequired(true).setMinValue(1))
    )
    .addSubcommand((sub) =>
      sub.setName('editar').setDescription('Editar la razón de un caso')
        .addIntegerOption((opt) => opt.setName('numero').setDescription('Número del caso').setRequired(true).setMinValue(1))
        .addStringOption((opt) => opt.setName('razon').setDescription('Nueva razón').setRequired(true).setMaxLength(512))
    )
    .addSubcommand((sub) =>
      sub.setName('lista').setDescription('Ver todos los casos de un usuario')
        .addUserOption((opt) => opt.setName('usuario').setDescription('Usuario').setRequired(true))
        .addIntegerOption((opt) => opt.setName('pagina').setDescription('Página').setMinValue(1))
    ),

  category: 'moderation',
  permissions: [PermissionFlagsBits.ModerateMembers],
  guildOnly: true,

  async execute(interaction) {
    if (!interaction.guild) return;
    const sub = interaction.options.getSubcommand();

    // ---- VER CASO ----
    if (sub === 'ver') {
      const caseNum = interaction.options.getInteger('numero', true);

      await interaction.deferReply({ ephemeral: true });

      const caseRecord = await prisma.moderationCase.findUnique({
        where: { guildId_caseNumber: { guildId: interaction.guild.id, caseNumber: caseNum } },
        include: { moderation: true },
      });

      if (!caseRecord) {
        await interaction.editReply({
          embeds: [new EmbedBuilder().setColor(Colors.ERROR).setDescription(`❌ Caso #${caseNum} no encontrado.`)],
        });
        return;
      }

      const embed = new EmbedBuilder()
        .setColor(Colors.INFO)
        .setTitle(`📋 Caso #${caseRecord.caseNumber}`)
        .addFields(
          { name: '📌 Tipo', value: caseRecord.type, inline: true },
          { name: '👤 Usuario', value: userMention(caseRecord.targetId), inline: true },
          { name: '🛡️ Moderador', value: userMention(caseRecord.moderatorId), inline: true },
          { name: '📝 Razón', value: caseRecord.reason },
          { name: '📅 Fecha', value: time(caseRecord.createdAt, TimestampStyles.LongDateTime), inline: true },
        );

      if (caseRecord.moderation.duration) {
        embed.addFields({
          name: '⏱️ Duración',
          value: formatDuration(caseRecord.moderation.duration),
          inline: true,
        });
      }

      if (caseRecord.editedReason) {
        embed.addFields({
          name: '✏️ Razón editada',
          value: `${caseRecord.editedReason}\n*por ${userMention(caseRecord.editedBy!)} el ${time(caseRecord.editedAt!, TimestampStyles.ShortDateTime)}*`,
        });
      }

      if (caseRecord.evidence.length > 0) {
        embed.addFields({ name: '🔗 Evidencias', value: caseRecord.evidence.join('\n') });
      }

      embed.setFooter({ text: `Estado: ${caseRecord.moderation.status}` });

      await interaction.editReply({ embeds: [embed] });
    }

    // ---- EDITAR CASO ----
    else if (sub === 'editar') {
      const caseNum = interaction.options.getInteger('numero', true);
      const newReason = interaction.options.getString('razon', true);

      await interaction.deferReply({ ephemeral: true });

      const caseRecord = await prisma.moderationCase.findUnique({
        where: { guildId_caseNumber: { guildId: interaction.guild.id, caseNumber: caseNum } },
      });

      if (!caseRecord) {
        await interaction.editReply({
          embeds: [new EmbedBuilder().setColor(Colors.ERROR).setDescription(`❌ Caso #${caseNum} no encontrado.`)],
        });
        return;
      }

      await prisma.moderationCase.update({
        where: { id: caseRecord.id },
        data: {
          editedReason: newReason,
          editedBy: interaction.user.id,
          editedAt: new Date(),
        },
      });

      const embed = new EmbedBuilder()
        .setColor(Colors.SUCCESS)
        .setTitle(`✏️ Caso #${caseNum} Actualizado`)
        .addFields(
          { name: '📝 Razón anterior', value: caseRecord.reason },
          { name: '📝 Nueva razón', value: newReason },
        )
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    }

    // ---- LISTA DE CASOS ----
    else if (sub === 'lista') {
      const target = interaction.options.getUser('usuario', true);
      const page = interaction.options.getInteger('pagina') ?? 1;
      const perPage = 10;

      await interaction.deferReply({ ephemeral: true });

      const [cases, total] = await Promise.all([
        prisma.moderationCase.findMany({
          where: { guildId: interaction.guild.id, targetId: target.id },
          orderBy: { caseNumber: 'desc' },
          skip: (page - 1) * perPage,
          take: perPage,
        }),
        prisma.moderationCase.count({
          where: { guildId: interaction.guild.id, targetId: target.id },
        }),
      ]);

      if (total === 0) {
        await interaction.editReply({
          embeds: [new EmbedBuilder().setColor(Colors.INFO).setDescription(`✅ ${target.tag} no tiene casos registrados.`)],
        });
        return;
      }

      const embed = new EmbedBuilder()
        .setColor(Colors.INFO)
        .setTitle(`📋 Casos de ${target.tag}`)
        .setDescription(
          cases.map((c) =>
            `**#${c.caseNumber}** | \`${c.type}\` | ${time(c.createdAt, TimestampStyles.ShortDate)} | ${c.reason.slice(0, 50)}${c.reason.length > 50 ? '...' : ''}`
          ).join('\n')
        )
        .setFooter({ text: `Total: ${total} casos | Página ${page}/${Math.ceil(total / perPage)}` })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    }
  },
};

export default command;
