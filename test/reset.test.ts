import { describe, expect, it } from 'vitest';
import { RESET_TABLES, RESET_TABLE_LABELS, tablesForScope, type ResetTable } from '../src/db/reset';

/**
 * Which tables each resettable table points at, read straight out of the REFERENCES clauses in
 * /migrations. This is the thing the delete order has to respect: a table must be emptied before
 * anything it points at is. If a later slice adds a foreign key, add it here - a wrong order shows
 * up as a failed reset in front of the children, which is exactly when nobody can debug it.
 */
const REFERENCES: Record<ResetTable, string[]> = {
  stud_bookings: ['stud_listings', 'coverings', 'horses', 'stables'],
  stud_listings: ['horses', 'stables'],
  listings: ['horses', 'stables'],
  import_candidates: ['import_offers', 'horses'],
  import_offers: ['stables', 'accounts', 'breeds'],
  show_entries: ['show_classes', 'horses', 'stables'],
  horse_show_summary: ['horses'],
  show_classes: ['shows', 'breeds', 'judges'],
  shows: [],
  pregnancies: ['coverings', 'horses'],
  coverings: ['stables', 'horses'],
  events: ['stables', 'horses'],
  horse_ancestors: ['horses'],
  horse_knowledge: ['stables', 'horses'],
  horse_conditions: ['horses', 'conditions'],
  horses: ['breeds', 'horses', 'stables'],
  stable_prefix_history: ['stables'],
  ledger: ['stables'],
  npc_policy: ['stables', 'breeds', 'disciplines'],
  buy_offers: ['stables'],
  stables: ['accounts'],
  tick_run: [],
};

/** Tables a reset must never empty - see the header comment in src/db/reset.ts. */
const NEVER_CLEARED = ['accounts', 'config', 'config_audit', 'breeds', 'loci', 'quantitative_traits', 'judges', 'conditions', 'disciplines', 'npc_ceiling_schedule', 'world', 'd1_migrations'];

describe('reset delete order', () => {
  it('empties every table before the tables it points at', () => {
    const position = new Map<string, number>(RESET_TABLES.map((t, i) => [t, i]));

    for (const [table, targets] of Object.entries(REFERENCES) as [ResetTable, string[]][]) {
      for (const target of targets) {
        if (target === table) continue; // horses.sire_id/dam_id - same statement, checked at its end
        const targetPosition = position.get(target);
        if (targetPosition === undefined) continue; // points at something a reset keeps
        expect(position.get(table), `${table} must be emptied before ${target}`).toBeLessThan(targetPosition);
      }
    }
  });

  it('never touches accounts, config or the reference tables', () => {
    for (const kept of NEVER_CLEARED) {
      expect(RESET_TABLES as readonly string[]).not.toContain(kept);
    }
  });

  it('covers every resettable table with a dependency entry and a label', () => {
    for (const table of RESET_TABLES) {
      expect(REFERENCES[table], `${table} has no REFERENCES entry in this test`).toBeDefined();
      expect(RESET_TABLE_LABELS[table], `${table} has no plain-English label`).toBeTruthy();
    }
  });
});

describe('tablesForScope', () => {
  it('the horses scope is the front of the full list, in the same order', () => {
    const horses = tablesForScope('horses');
    expect(horses).toEqual(RESET_TABLES.slice(0, horses.length));
  });

  it('the horses scope keeps stables and their prefixes', () => {
    expect(tablesForScope('horses')).not.toContain('stables');
    expect(tablesForScope('horses')).not.toContain('stable_prefix_history');
  });

  it('the world scope clears everything', () => {
    expect(tablesForScope('world')).toEqual([...RESET_TABLES]);
  });
});
