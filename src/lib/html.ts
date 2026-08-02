// A tiny tagged-template helper that escapes interpolated values by default. Everything
// user-typed - stable names, prefixes, display names - goes through this. No template engine,
// no client framework, no build step for the front end.

export class SafeHtml {
  constructor(public readonly value: string) {}
}

export function escapeHtml(value: unknown): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Opt-out for a fragment that is already safe HTML (e.g. built from another `html` call). */
export function raw(value: string): SafeHtml {
  return new SafeHtml(value);
}

function renderValue(value: unknown): string {
  if (value instanceof SafeHtml) return value.value;
  if (Array.isArray(value)) return value.map(renderValue).join('');
  if (value === null || value === undefined) return '';
  return escapeHtml(value);
}

export function html(strings: TemplateStringsArray, ...values: unknown[]): SafeHtml {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) {
    out += renderValue(values[i]);
    out += strings[i + 1];
  }
  return new SafeHtml(out);
}
