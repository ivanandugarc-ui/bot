/**
 * GUARDIAN BOT - Bot Client
 * Instancia principal del cliente Discord
 */

import 'dotenv/config';
import { Client, GatewayIntentBits, Partials, Collection } from 'discord.js';
import { logger } from './utils/logger';
import { prisma } from './database/client';
import { redis } from './database/redis';
import { loadCommands } from './handlers/commandHandler';
import { loadEvents } from './handlers/eventHandler';
import { initAutomod } from './automod';
import { initAntiRaid } from './antiraid';
import type { Command } from './types';

// ================================
// EXTENDED CLIENT
// ================================

export class GuardianClient extends Client {
  commands: Collection<string, Command> = new Collection();
  cooldowns: Collection<string, Collection<string, number>> = new Collection();
  uptime_start: number = Date.now();

  constructor() {
    super({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildModeration,
        GatewayIntentBits.GuildEmojisAndStickers,
        GatewayIntentBits.GuildIntegrations,
        GatewayIntentBits.GuildWebhooks,
        GatewayIntentBits.GuildInvites,
        GatewayIntentBits.GuildPresences,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.GuildMessageTyping,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
      ],
      partials: [
        Partials.Message,
        Partials.Channel,
        Partials.Reaction,
        Partials.GuildMember,
        Partials.User,
      ],
      allowedMentions: {
        parse: ['users', 'roles'],
        repliedUser: true,
      },
    });
  }

  async start(): Promise<void> {
    logger.info('[Bot] Iniciando Guardian Bot...');

    try {
      // 1. Conectar base de datos
      await prisma.$connect();
      logger.info('[Bot] PostgreSQL conectado');

      // 2. Conectar Redis
      await redis.ping();
      logger.info('[Bot] Redis conectado');

      // 3. Cargar comandos
      await loadCommands(this);
      logger.info(`[Bot] ${this.commands.size} comandos cargados`);

      // 4. Cargar eventos
      await loadEvents(this);
      logger.info('[Bot] Eventos registrados');

      // 5. Inicializar módulos
      await initAutomod(this);
      await initAntiRaid(this);
      logger.info('[Bot] Módulos de seguridad inicializados');

      // 6. Login en Discord
      await this.login(process.env['DISCORD_TOKEN']);

    } catch (error) {
      logger.error('[Bot] Error en la inicialización:', error);
      await this.shutdown();
      process.exit(1);
    }
  }

  async shutdown(): Promise<void> {
    logger.info('[Bot] Apagando...');
    try {
      await prisma.$disconnect();
      redis.disconnect();
      this.destroy();
      logger.info('[Bot] Apagado correctamente');
    } catch (error) {
      logger.error('[Bot] Error al apagar:', error);
    }
  }
}

// Instancia y arranque
const client = new GuardianClient();

client.start().catch((error) => {
  logger.error('[Bot] Error fatal:', error);
  process.exit(1);
});

// Manejo de señales de apagado
process.on('SIGTERM', () => client.shutdown());
process.on('SIGINT', () => client.shutdown());
