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
