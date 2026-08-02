import { describe, expect, it } from 'vitest';
import { splitSqlStatements } from '../src/lib/sql';

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
