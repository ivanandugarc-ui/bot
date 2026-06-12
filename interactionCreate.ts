/**
 * GUARDIAN BOT - interactionCreate Event
 * Manejo central de todas las interacciones
 */

import {
  ChatInputCommandInteraction,
  AutocompleteInteraction,
  ButtonInteraction,
  StringSelectMenuInteraction,
  ModalSubmitInteraction,
  PermissionsBitField,
  EmbedBuilder,
} from 'discord.js';
import { logger } from '../utils/logger';
import { Colors } from '../types';
import { redis } from '../database/redis';
import { handleButton } from '../handlers/buttonHandler';
import { handleSelect } from '../handlers/selectHandler';
import { handleModal } from '../handlers/modalHandler';
import type { GuardianClient } from '../bot';
import type { Event } from '../types';

const RATE_LIMIT_WINDOW = parseInt(process.env['RATE_LIMIT_WINDOW'] ?? '60000') / 1000;
const RATE_LIMIT_MAX = parseInt(process.env['RATE_LIMIT_MAX'] ?? '30');

const event: Event = {
  name: 'interactionCreate',
  async execute(interaction: unknown) {
    const client = (interaction as ChatInputCommandInteraction).client as GuardianClient;

    // ---- Slash Commands ----
    if ((interaction as ChatInputCommandInteraction).isChatInputCommand()) {
      await handleSlashCommand(interaction as ChatInputCommandInteraction, client);
      return;
    }

    // ---- Autocomplete ----
    if ((interaction as AutocompleteInteraction).isAutocomplete()) {
      await handleAutocomplete(interaction as AutocompleteInteraction, client);
      return;
    }

    // ---- Botones ----
    if ((interaction as ButtonInteraction).isButton()) {
      await handleButton(interaction as ButtonInteraction, client);
      return;
    }

    // ---- Select Menus ----
    if ((interaction as StringSelectMenuInteraction).isStringSelectMenu()) {
      await handleSelect(interaction as StringSelectMenuInteraction, client);
      return;
    }

    // ---- Modals ----
    if ((interaction as ModalSubmitInteraction).isModalSubmit()) {
      await handleModal(interaction as ModalSubmitInteraction, client);
      return;
    }
  },
};

// ================================
// SLASH COMMANDS
// ================================

async function handleSlashCommand(
  interaction: ChatInputCommandInteraction,
  client: GuardianClient
): Promise<void> {
  const command = client.commands.get(interaction.commandName);

  if (!command) {
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(Colors.ERROR)
          .setDescription('❌ Comando no encontrado.')
      ],
      ephemeral: true,
    });
    return;
  }

  // Solo en servidores
  if (command.guildOnly && !interaction.guildId) {
    await interaction.reply({
      embeds: [new EmbedBuilder().setColor(Colors.ERROR).setDescription('❌ Solo disponible en servidores.')],
      ephemeral: true,
    });
    return;
  }

  // Rate limiting por usuario
  const rateLimitKey = `rl:${interaction.user.id}`;
  const requests = await redis.incr(rateLimitKey);
  if (requests === 1) await redis.expire(rateLimitKey, RATE_LIMIT_WINDOW);

  if (requests > RATE_LIMIT_MAX) {
    await interaction.reply({
      embeds: [new EmbedBuilder().setColor(Colors.WARNING).setDescription('⏱️ Demasiados comandos. Espera un momento.')],
      ephemeral: true,
    });
    return;
  }

  // Cooldown por comando
  if (command.cooldown) {
    const cooldownKey = `cooldown:${interaction.user.id}:${command.data.name}`;
    const lastUsed = await redis.get(cooldownKey);

    if (lastUsed) {
      const remaining = command.cooldown - (Date.now() - parseInt(lastUsed)) / 1000;
      if (remaining > 0) {
        await interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(Colors.WARNING)
              .setDescription(`⏱️ Espera **${remaining.toFixed(1)}s** para usar este comando de nuevo.`)
          ],
          ephemeral: true,
        });
        return;
      }
    }

    await redis.setex(cooldownKey, command.cooldown, Date.now().toString());
  }

  // Permisos del usuario
  if (command.permissions && interaction.memberPermissions) {
    const missing = (interaction.memberPermissions as PermissionsBitField).missing(command.permissions);
    if (missing.length > 0) {
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(Colors.ERROR)
            .setDescription(`❌ No tienes los permisos necesarios: \`${missing.join(', ')}\``)
        ],
        ephemeral: true,
      });
      return;
    }
  }

  // Permisos del bot
  if (command.botPermissions && interaction.guild?.members.me?.permissions) {
    const missing = interaction.guild.members.me.permissions.missing(command.botPermissions);
    if (missing.length > 0) {
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(Colors.ERROR)
            .setDescription(`❌ Me faltan permisos: \`${missing.join(', ')}\``)
        ],
        ephemeral: true,
      });
      return;
    }
  }

  // Ejecutar comando
  try {
    logger.info(`[CMD] /${command.data.name} por ${interaction.user.tag} en ${interaction.guildId}`);
    await command.execute(interaction, client);
  } catch (error) {
    logger.error(`[CMD] Error en /${command.data.name}:`, error);

    const errorEmbed = new EmbedBuilder()
      .setColor(Colors.ERROR)
      .setTitle('❌ Error interno')
      .setDescription('Ocurrió un error al ejecutar este comando. Ha sido reportado automáticamente.')
      .setTimestamp();

    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ embeds: [errorEmbed] });
    } else {
      await interaction.reply({ embeds: [errorEmbed], ephemeral: true });
    }
  }
}

// ================================
// AUTOCOMPLETE
// ================================

async function handleAutocomplete(
  interaction: AutocompleteInteraction,
  client: GuardianClient
): Promise<void> {
  const command = client.commands.get(interaction.commandName);
  if (!command?.autocomplete) return;

  try {
    await command.autocomplete(interaction, client);
  } catch (error) {
    logger.error(`[Autocomplete] Error en ${interaction.commandName}:`, error);
  }
}

export default event;
