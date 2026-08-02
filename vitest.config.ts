// Vitest runs migration files through Vite's normal module pipeline, which - unlike wrangler's own
// [[rules]] Text-loader in wrangler.toml - doesn't know how to import a .sql file. This plugin
// gives it the same treatment: export the file's raw text as the default export. Test-only; it has
// no effect on the real Worker build, which wrangler bundles on its own.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    {
      name: 'sql-as-raw-text',
      transform(code, id) {
        if (id.endsWith('.sql')) {
          return `export default ${JSON.stringify(code)};`;
        }
      },
    },
  ],
});
