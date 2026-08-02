// Splits a migration file's SQL text into individual statements. D1's prepare() accepts exactly
// one statement, and its exec() (which does accept several) requires them newline-separated and
// chokes on our pretty-printed, multi-line CREATE TABLE statements - see
// https://github.com/cloudflare/workers-sdk/issues/9133. So instead: strip `--` line comments,
// then split on `;`. This assumes a migration never puts `--` or `;` inside a string literal or
// block comment - true of every migration in /migrations today. If a future migration needs
// either, applying it through /admin/migrations will misbehave; apply it with the CLI
// (`npm run migrate:remote`) instead, or extend this splitter first.
export function splitSqlStatements(sql: string): string[] {
  const withoutComments = sql
    .split('\n')
    .map((line) => {
      const idx = line.indexOf('--');
      return idx === -1 ? line : line.slice(0, idx);
    })
    .join('\n');

  return withoutComments
    .split(';')
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}
