// Seeded templates (SPEC §4): editable copies the user may delete; "Restore templates" in Settings re-seeds the missing
// ones. Names and interval names are translated at seed time (they are plain rows afterwards).
import { block, DEFAULT_PREFS, interval, type TimerDef } from '@/engine/model';
import { COLORS } from '@/engine/palette';
import type { Translator } from '@/i18n';

import { getSetting, setSetting } from './settings';
import { createTimer, listTimers } from './timers';
import { withTransaction } from './tx';
import type { Db } from './types';

export type TemplateId = 'tabata' | 'hiit' | 'emom' | 'boxing' | 'walkRun' | 'circuit' | 'stretch';
export const TEMPLATE_IDS: readonly TemplateId[] = ['tabata', 'hiit', 'emom', 'boxing', 'walkRun', 'circuit', 'stretch'];

export function templateDef(id: TemplateId, t: Translator): TimerDef {
  const work = (s: number) => interval(t('interval.work'), s, 'work');
  const rest = (s: number) => interval(t('interval.rest'), s, 'rest');
  const prefs = { ...DEFAULT_PREFS };
  switch (id) {
    case 'tabata':
      return { name: t('template.tabata'), color: COLORS.red, notes: '', prefs, blocks: [block([work(20), rest(10)], { rounds: 8 })] };
    case 'hiit':
      return { name: t('template.hiit'), color: COLORS.orange, notes: '', prefs, blocks: [block([work(30), rest(15)], { rounds: 10 })] };
    case 'emom':
      return {
        name: t('template.emom'),
        color: COLORS.purple,
        notes: '',
        prefs,
        blocks: [block([interval(t('interval.minute'), 60, 'work', { halfwayCue: true })], { rounds: 10 })],
      };
    case 'boxing':
      return {
        name: t('template.boxing'),
        color: COLORS.blue,
        notes: '',
        prefs,
        blocks: [block([interval(t('interval.round'), 180, 'work', { halfwayCue: true }), rest(60)], { rounds: 12 })],
      };
    case 'walkRun':
      return {
        name: t('template.walkRun'),
        color: COLORS.green,
        notes: '',
        prefs,
        blocks: [block([interval(t('interval.walk'), 60, 'rest'), interval(t('interval.run'), 60, 'work')], { rounds: 15 })],
      };
    case 'circuit':
      return {
        name: t('template.circuit'),
        color: COLORS.teal,
        notes: '',
        prefs,
        blocks: [
          block(
            Array.from({ length: 6 }, (_, i) => [interval(t('interval.station', { n: i + 1 }), 45, 'work'), rest(15)]).flat(),
            { rounds: 3, restBetweenRoundsS: 60 }
          ),
        ],
      };
    case 'stretch':
      return {
        name: t('template.stretch'),
        color: COLORS.indigo,
        notes: '',
        prefs: { ...prefs, prepSeconds: 5 },
        blocks: [block([interval(t('interval.stretch'), 30, 'cooldown', { countdownCue: false })], { rounds: 10 })],
      };
  }
}

/** First start: seeds every template once (idempotent through the `templates_seeded` setting). */
export function seedTemplatesOnce(db: Db, t: Translator, now = Date.now()): Promise<boolean> {
  // One transaction: a crash half-way leaves neither templates nor the flag (REVIEW S1).
  return withTransaction(db, async (tx) => {
    if (await getSetting(tx, 'templatesSeeded')) return false;
    for (const id of TEMPLATE_IDS) await createTimer(tx, templateDef(id, t), now, 'template');
    await setSetting(tx, 'templatesSeeded', true);
    return true;
  });
}

/** Settings → "Restore templates": re-adds the templates whose name is missing; returns how many were added. */
export async function restoreTemplates(db: Db, t: Translator, now = Date.now()): Promise<number> {
  const existing = new Set((await listTimers(db)).filter((x) => x.kind === 'template').map((x) => x.name));
  let added = 0;
  for (const id of TEMPLATE_IDS) {
    const def = templateDef(id, t);
    if (existing.has(def.name)) continue;
    await createTimer(db, def, now, 'template');
    added++;
  }
  return added;
}
