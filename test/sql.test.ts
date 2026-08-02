import { describe, expect, it } from 'vitest';
import { splitSqlStatements } from '../src/lib/sql';
import { MIGRATIONS } from '../src/db/migrations';

describe('splitSqlStatements', () => {
  it('splits a multi-line CREATE TABLE and a trailing CREATE INDEX', () => {
    const sql = `-- a table\nCREATE TABLE t (\n  id INTEGER PRIMARY KEY,\n  name TEXT NOT NULL\n);\n\nCREATE INDEX idx_t_name ON t (name);\n`;
    expect(splitSqlStatements(sql)).toEqual(['CREATE TABLE t (\n  id INTEGER PRIMARY KEY,\n  name TEXT NOT NULL\n)', 'CREATE INDEX idx_t_name ON t (name)']);
  });

  it('strips full-line and same-line comments without touching statement content', () => {
    const sql = `-- comment one\nCREATE TABLE t (id INTEGER); -- trailing note\n-- comment two\n`;
    expect(splitSqlStatements(sql)).toEqual(['CREATE TABLE t (id INTEGER)']);
  });

  it('does not treat -- inside this codebase\'s JSON seed strings as a problem, since none contain it', () => {
    const sql = `INSERT INTO config (id, "values") VALUES (1, '{"a":1,"b":2}');\n`;
    expect(splitSqlStatements(sql)).toEqual(['INSERT INTO config (id, "values") VALUES (1, \'{"a":1,"b":2}\')']);
  });

  it('drops blank statements from stray semicolons or blank lines', () => {
    const sql = `\n\nCREATE TABLE t (id INTEGER);\n\n\n`;
    expect(splitSqlStatements(sql)).toEqual(['CREATE TABLE t (id INTEGER)']);
  });

  it('returns an empty array for an all-comment file', () => {
    expect(splitSqlStatements('-- nothing here\n-- still nothing\n')).toEqual([]);
  });
});

// Slice 0010 §5's own warning, twice: this splitter has no awareness of string literals, and a
// stray ";" or "--" inside a teaching_text/event_text value silently corrupts the migration - the
// exact failure slice 0008 lost an afternoon to. These migrations carry the longest prose ever
// inserted into this database, so this checks the real files rather than trusting the warning was
// followed by eye.
describe('splitSqlStatements against the real slice 0010 seed migrations', () => {
  it('0053_seed_conditions.sql splits into exactly one INSERT, with all four condition codes intact inside it', () => {
    const migration = MIGRATIONS.find((m) => m.name === '0053_seed_conditions.sql');
    expect(migration).toBeDefined();
    const statements = splitSqlStatements(migration!.sql);
    expect(statements).toHaveLength(1);
    for (const code of ['HYPP', 'PSSM1', 'HERDA', 'GBED']) {
      expect(statements[0]).toContain(`'${code}'`);
    }
    // The GBED event_text is the longest, multi-paragraph value in the file - if a stray ";" or
    // "--" had split or truncated it, this substring (from the middle of its third paragraph)
    // would not survive intact inside the single statement asserted above.
    expect(statements[0]).toContain('Two carriers bred together have about a one in four chance');
  });

  it('0050_seed_disease_loci.sql splits into exactly one INSERT with all four loci', () => {
    const migration = MIGRATIONS.find((m) => m.name === '0050_seed_disease_loci.sql');
    expect(migration).toBeDefined();
    const statements = splitSqlStatements(migration!.sql);
    expect(statements).toHaveLength(1);
    for (const code of ['HYPP', 'PSSM1', 'HERDA', 'GBED']) {
      expect(statements[0]).toContain(`'${code}'`);
    }
  });

  it('0051_breed_pools_disease_loci.sql splits into exactly eight UPDATEs, one per breed', () => {
    const migration = MIGRATIONS.find((m) => m.name === '0051_breed_pools_disease_loci.sql');
    expect(migration).toBeDefined();
    expect(splitSqlStatements(migration!.sql)).toHaveLength(8);
  });

  it('0057_ledger_add_vet_kind.sql splits into the five statements the rebuild needs', () => {
    const migration = MIGRATIONS.find((m) => m.name === '0057_ledger_add_vet_kind.sql');
    expect(migration).toBeDefined();
    // CREATE TABLE ledger_new, INSERT ... SELECT, DROP TABLE, ALTER TABLE RENAME, CREATE INDEX.
    expect(splitSqlStatements(migration!.sql)).toHaveLength(5);
  });
});
