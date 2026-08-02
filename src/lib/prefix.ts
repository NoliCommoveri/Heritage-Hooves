// Prefix validation, per slice §7.1. Pure - no database access. Uniqueness is not checked here;
// it is enforced by attempting the insert into stable_prefix_history and catching the
// unique-constraint failure (a prior SELECT would have a race in it).

export interface PrefixValidation {
  ok: boolean;
  error?: string;
}

export function validatePrefix(input: string): PrefixValidation {
  const trimmed = input.trim();

  if (trimmed.length < 2 || trimmed.length > 20) {
    return { ok: false, error: 'Prefix must be between 2 and 20 characters.' };
  }
  if (!/^[A-Za-z '-]+$/.test(trimmed)) {
    return { ok: false, error: 'Prefix can only contain letters, spaces, apostrophes and hyphens.' };
  }
  if (!/^[A-Za-z]/.test(trimmed) || !/[A-Za-z]$/.test(trimmed)) {
    return { ok: false, error: 'Prefix must start and end with a letter.' };
  }
  if (/ {2,}/.test(trimmed)) {
    return { ok: false, error: 'Prefix cannot contain consecutive spaces.' };
  }
  return { ok: true };
}

/** The prefix as it will be stored: trimmed, capitals and all. Compared case-insensitively by the DB. */
export function normalizePrefix(input: string): string {
  return input.trim();
}
