/**
 * GUARDIAN BOT - ready Event
 */

import { ActivityType } from 'discord.js';
import { logger } from '../utils/logger';
import type { GuardianClient } from '../bot';
import type { Event } from '../types';

const event: Event = {
  name: 'ready',
  once: true,
  async execute(client: unknown) {
    const bot = client as GuardianClient;

    logger.info(`✅ Guardian Bot listo como: ${bot.user?.tag}`);
    logger.info(`📊 Servidores: ${bot.guilds.cache.size}`);
    logger.info(`👥 Usuarios: ${bot.users.cache.size}`);

    // Actividad del bot
    const statuses = [
      { name: `${bot.guilds.cache.size} servidores`, type: ActivityType.Watching },
      { name: '/help | Guardian Bot', type: ActivityType.Playing },
      { name: 'la comunidad', type: ActivityType.Watching },
    ];

    let idx = 0;
    const setStatus = () => {
      const status = statuses[idx % statuses.length];
      if (status && bot.user) {
        bot.user.setActivity(status.name, { type: status.type });
      }
      idx++;
    };

    setStatus();
    setInterval(setStatus, 60_000); // Cambia cada minuto
  },
};

export default event;
