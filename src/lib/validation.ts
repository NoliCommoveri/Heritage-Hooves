export interface HorseNameValidation {
  ok: boolean;
  error?: string;
}

/** The part of a horse's name a player types - the prefix is stamped on in front of it, never typed. */
export function validateHorseNamePart(input: string): HorseNameValidation {
  const trimmed = input.trim();
  if (trimmed.length < 1 || trimmed.length > 40) {
    return { ok: false, error: 'Name must be between 1 and 40 characters.' };
  }
  if (!/^[A-Za-z0-9 '-]+$/.test(trimmed)) {
    return { ok: false, error: 'Name can only contain letters, numbers, spaces, apostrophes and hyphens.' };
  }
  return { ok: true };
}

export function validateNewAccountForm(
  displayName: string,
  username: string,
  password: string,
  confirmPassword: string,
  minPasswordLength: number
): string | undefined {
  if (!displayName) return 'Your name is required.';
  if (!username) return 'Username is required.';
  if (password.length < minPasswordLength) return `Password must be at least ${minPasswordLength} characters.`;
  if (password !== confirmPassword) return 'Passwords do not match.';
  return undefined;
}
