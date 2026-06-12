/**
 * GUARDIAN BOT - Entry Point
 * Bot de Discord Premium para moderación y administración
 */

import 'dotenv/config';
import { ShardingManager } from 'discord.js';
import path from 'path';
import { logger } from './utils/logger';
import { validateEnv } from './config/env';

// Validar variables de entorno antes de iniciar
validateEnv();

const shardFile = path.join(__dirname, 'bot.js');

const manager = new ShardingManager(shardFile, {
  token: process.env['DISCORD_TOKEN'],
  totalShards: process.env['BOT_SHARDS'] === 'auto' ? 'auto' : parseInt(process.env['BOT_SHARDS'] ?? '1'),
  shardArgs: [],
  execArgv: [],
});

manager.on('shardCreate', (shard) => {
  logger.info(`[Sharding] Shard #${shard.id} lanzado`);

  shard.on('ready', () => {
    logger.info(`[Sharding] Shard #${shard.id} listo`);
  });

  shard.on('disconnect', () => {
    logger.warn(`[Sharding] Shard #${shard.id} desconectado`);
  });

  shard.on('reconnecting', () => {
    logger.info(`[Sharding] Shard #${shard.id} reconectando...`);
  });

  shard.on('error', (error) => {
    logger.error(`[Sharding] Error en Shard #${shard.id}:`, error);
  });
});

manager.spawn().then(() => {
  logger.info('[Guardian Bot] Todos los shards iniciados correctamente');
}).catch((error) => {
  logger.error('[Guardian Bot] Error al iniciar shards:', error);
  process.exit(1);
});

// Manejo de errores no capturados
process.on('uncaughtException', (error) => {
  logger.error('[Proceso] Error no capturado:', error);
});

process.on('unhandledRejection', (reason) => {
  logger.error('[Proceso] Promesa rechazada no manejada:', reason);
});
