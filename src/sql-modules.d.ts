// Lets TypeScript (and the Worker bundler, via the [[rules]] entry in wrangler.toml) treat an
// imported .sql file as its raw text content.
declare module '*.sql' {
  const content: string;
  export default content;
}
