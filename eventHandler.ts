/**
 * GUARDIAN BOT - Event Handler
 * Carga automática de todos los eventos
 */

import { readdirSync } from 'fs';
import path from 'path';
import { logger } from '../utils/logger';
import type { GuardianClient } from '../bot';
import type { Event } from '../types';

export async function loadEvents(client: GuardianClient): Promise<void> {
  const eventsPath = path.join(__dirname, '..', 'events');

  try {
    const files = readdirSync(eventsPath).filter((f) => f.endsWith('.ts') || f.endsWith('.js'));

    for (const file of files) {
      try {
        const filePath = path.join(eventsPath, file);
        const event = (await import(filePath)) as { default: Event };

        if (!event.default?.name || !event.default?.execute) {
          logger.warn(`[Events] Evento inválido en ${filePath}`);
          continue;
        }

        const handler = (...args: unknown[]) => event.default.execute(...args);

        if (event.default.once) {
          client.once(event.default.name, handler);
        } else {
          client.on(event.default.name, handler);
        }

        logger.debug(`[Events] Registrado: ${event.default.name}`);
      } catch (error) {
        logger.error(`[Events] Error cargando ${file}:`, error);
      }
    }

    logger.info(`[Events] Total: ${files.length} eventos registrados`);
  } catch (error) {
    logger.error('[Events] Error cargando eventos:', error);
    throw error;
  }
}
