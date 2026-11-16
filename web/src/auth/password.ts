// Reglas de contraseña de v2 (Global Constraints): NFC y entre 12 y 128
// puntos de código. La contraseña solo vive en el estado del formulario; este
// módulo es puro y no guarda nada.

export type PasswordProblem = 'short' | 'long' | 'mismatch';

const MIN_LEN = 12;
const MAX_LEN = 128;

function normalize(password: string): string {
  return password.normalize('NFC');
}

function codePoints(password: string): number {
  return [...password].length;
}

export function passwordProblems(
  password: string,
  confirm?: string,
): PasswordProblem[] {
  const normalized = normalize(password);
  const length = codePoints(normalized);
  const problems: PasswordProblem[] = [];
  if (length < MIN_LEN) problems.push('short');
  if (length > MAX_LEN) problems.push('long');
  if (confirm !== undefined && normalized !== normalize(confirm)) {
    problems.push('mismatch');
  }
  return problems;
}
