// Helpers for reading one question's answers across the hours of a day.
import type { EngineResult } from './engine';

export const DAY_HOURS = Array.from({ length: 24 }, (_, h) => h);
/** The R3 window: open from 09:00, closed from 18:00. */
export const OPENS = 9;
export const CLOSES = 18;

export const hh = (h: number) => `${String(h).padStart(2, '0')}:00`;
export const inHours = (h: number) => h >= OPENS && h < CLOSES;

/** Hours at which the engines that have answered do not all agree. */
export function splitHours(results: Record<string, EngineResult[] | undefined>): Set<number> {
  const out = new Set<number>();
  for (const h of DAY_HOURS) {
    const seen = new Set<string>();
    for (const day of Object.values(results)) if (day) seen.add(day[h].decision);
    if (seen.size > 1) out.add(h);
  }
  return out;
}

/** Engines whose answer at hour h is the less common one, or none on an even split. */
export function minorityAt(
  results: Record<string, EngineResult[] | undefined>,
  h: number,
): Set<string> {
  const allow: string[] = [];
  const deny: string[] = [];
  for (const [id, day] of Object.entries(results)) {
    if (!day) continue;
    (day[h].decision === 'allow' ? allow : deny).push(id);
  }
  if (allow.length === 0 || deny.length === 0 || allow.length === deny.length) return new Set();
  return new Set(allow.length < deny.length ? allow : deny);
}
