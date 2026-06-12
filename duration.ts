/**
 * GUARDIAN BOT - Duration Utility
 * Parseo y formateo de duraciones de tiempo
 */

export interface ParsedDuration {
  seconds: number;
  formatted: string;
}

const UNITS: Record<string, number> = {
  s: 1,
  seg: 1,
  m: 60,
  min: 60,
  h: 3600,
  hr: 3600,
  d: 86400,
  dia: 86400,
  día: 86400,
  dias: 86400,
  días: 86400,
  w: 604800,
  sem: 604800,
  semana: 604800,
  semanas: 604800,
};

/**
 * Parsea strings de duración como "1h", "30m", "7d", "2w"
 */
export function parseDuration(input: string): ParsedDuration | null {
  const matches = input.toLowerCase().match(/(\d+)\s*(s|seg|m|min|h|hr|d|dia|día|dias|días|w|sem|semana|semanas)/g);

  if (!matches) {
    // Intentar parsear como número puro (segundos)
    const num = parseInt(input);
    if (!isNaN(num) && num > 0) {
      return { seconds: num, formatted: formatDuration(num) };
    }
    return null;
  }

  let total = 0;
  for (const match of matches) {
    const numMatch = match.match(/(\d+)/);
    const unitMatch = match.match(/[a-záíóúñ]+/i);
    if (!numMatch || !unitMatch) continue;

    const num = parseInt(numMatch[1] ?? '0');
    const unit = unitMatch[0];
    const multiplier = UNITS[unit ?? ''] ?? 0;
    total += num * multiplier;
  }

  if (total <= 0) return null;

  return { seconds: total, formatted: formatDuration(total) };
}

/**
 * Formatea segundos en texto legible
 */
export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds} segundo${seconds !== 1 ? 's' : ''}`;

  const parts: string[] = [];

  const weeks = Math.floor(seconds / 604800);
  if (weeks > 0) {
    parts.push(`${weeks} semana${weeks !== 1 ? 's' : ''}`);
    seconds %= 604800;
  }

  const days = Math.floor(seconds / 86400);
  if (days > 0) {
    parts.push(`${days} día${days !== 1 ? 's' : ''}`);
    seconds %= 86400;
  }

  const hours = Math.floor(seconds / 3600);
  if (hours > 0) {
    parts.push(`${hours} hora${hours !== 1 ? 's' : ''}`);
    seconds %= 3600;
  }

  const minutes = Math.floor(seconds / 60);
  if (minutes > 0) {
    parts.push(`${minutes} minuto${minutes !== 1 ? 's' : ''}`);
    seconds %= 60;
  }

  if (seconds > 0) {
    parts.push(`${seconds} segundo${seconds !== 1 ? 's' : ''}`);
  }

  return parts.join(', ');
}

/**
 * Valida que la duración esté dentro de límites
 */
export function validateDuration(seconds: number, max: number = 2419200): string | null {
  if (seconds <= 0) return 'La duración debe ser positiva.';
  if (seconds > max) return `La duración máxima es ${formatDuration(max)}.`;
  return null;
}
