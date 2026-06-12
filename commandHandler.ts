/**
 * GUARDIAN BOT - Command Handler
 * Carga automática de todos los slash commands
 */

import { readdirSync, statSync } from 'fs';
import path from 'path';
import { logger } from '../utils/logger';
import type { GuardianClient } from '../bot';
import type { Command } from '../types';

export async function loadCommands(client: GuardianClient): Promise<void> {
  const commandsPath = path.join(__dirname, '..', 'commands');

  try {
    const categories = readdirSync(commandsPath).filter((f) =>
      statSync(path.join(commandsPath, f)).isDirectory()
    );

    for (const category of categories) {
      const categoryPath = path.join(commandsPath, category);
      const files = readdirSync(categoryPath).filter((f) => f.endsWith('.ts') || f.endsWith('.js'));

      for (const file of files) {
        try {
          const filePath = path.join(categoryPath, file);
          const command = (await import(filePath)) as { default: Command };

          if (!command.default?.data || !command.default?.execute) {
            logger.warn(`[Commands] Comando inválido en ${filePath}`);
            continue;
          }

          client.commands.set(command.default.data.name, command.default);
          logger.debug(`[Commands] Cargado: /${command.default.data.name} [${category}]`);
        } catch (error) {
          logger.error(`[Commands] Error cargando ${file}:`, error);
        }
      }
    }

    logger.info(`[Commands] Total: ${client.commands.size} comandos en ${categories.length} categorías`);
  } catch (error) {
    logger.error('[Commands] Error cargando comandos:', error);
    throw error;
  }
}
