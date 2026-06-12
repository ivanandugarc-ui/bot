/**
 * GUARDIAN BOT - Types & Interfaces
 */

import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  SlashCommandSubcommandsOnlyBuilder,
  PermissionResolvable,
  AutocompleteInteraction,
} from 'discord.js';
import { GuardianClient } from './bot';

// ================================
// COMMAND INTERFACE
// ================================

export interface Command {
  data: SlashCommandBuilder | SlashCommandSubcommandsOnlyBuilder | Omit<SlashCommandBuilder, 'addSubcommand' | 'addSubcommandGroup'>;
  category: CommandCategory;
  permissions?: PermissionResolvable[];
  botPermissions?: PermissionResolvable[];
  cooldown?: number; // segundos
  guildOnly?: boolean;
  premiumOnly?: boolean;
  staffOnly?: boolean;
  execute: (interaction: ChatInputCommandInteraction, client: GuardianClient) => Promise<void>;
  autocomplete?: (interaction: AutocompleteInteraction, client: GuardianClient) => Promise<void>;
}

export type CommandCategory =
  | 'moderation'
  | 'tickets'
  | 'automod'
  | 'verification'
  | 'reports'
  | 'appeals'
  | 'suggestions'
  | 'backup'
  | 'staff'
  | 'config'
  | 'utility';

// ================================
// EVENT INTERFACE
// ================================

export interface Event {
  name: string;
  once?: boolean;
  execute: (...args: unknown[]) => Promise<void>;
}

// ================================
// MODERATION TYPES
// ================================

export type ModerationAction =
  | 'BAN'
  | 'TEMPBAN'
  | 'UNBAN'
  | 'KICK'
  | 'MUTE'
  | 'TEMPMUTE'
  | 'UNMUTE'
  | 'TIMEOUT'
  | 'UNTIMEOUT'
  | 'WARN'
  | 'NOTE';

export interface ModerationOptions {
  guildId: string;
  targetId: string;
  moderatorId: string;
  action: ModerationAction;
  reason: string;
  duration?: number; // segundos
  evidence?: string[];
  metadata?: Record<string, unknown>;
  silent?: boolean;
}

export interface ModerationResult {
  success: boolean;
  caseId?: string;
  caseNumber?: number;
  error?: string;
}

// ================================
// AUTOMOD TYPES
// ================================

export interface AutomodViolation {
  type: AutomodViolationType;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  action: AutomodActionType;
  reason: string;
  content?: string;
  metadata?: Record<string, unknown>;
}

export type AutomodViolationType =
  | 'SPAM'
  | 'FLOOD'
  | 'SCAM'
  | 'PHISHING'
  | 'INVITE'
  | 'ADVERTISING'
  | 'MASS_MENTIONS'
  | 'TOXICITY'
  | 'HARASSMENT'
  | 'BAD_WORDS'
  | 'SUSPICIOUS_LINK'
  | 'DUPLICATE';

export type AutomodActionType = 'WARN' | 'TIMEOUT' | 'KICK' | 'BAN' | 'DELETE';

// ================================
// TICKET TYPES
// ================================

export interface TicketCreateOptions {
  guildId: string;
  userId: string;
  category: string;
  subject?: string;
  initialMessage?: string;
}

// ================================
// EMBED COLORS
// ================================

export const Colors = {
  PRIMARY: 0x5865F2,    // Discord Blurple
  SUCCESS: 0x57F287,    // Verde
  WARNING: 0xFEE75C,    // Amarillo
  ERROR: 0xED4245,      // Rojo
  INFO: 0x5DADE2,       // Azul claro
  MUTED: 0x99AAB5,      // Gris
  MOD: 0xFF6B35,        // Naranja moderación
  STAFF: 0xA855F7,      // Morado staff
  TICKET: 0x06B6D4,     // Cian tickets
  LOG: 0x2C3E50,        // Oscuro logs
} as const;

// ================================
// DURATION PARSING
// ================================

export interface ParsedDuration {
  seconds: number;
  formatted: string;
}
