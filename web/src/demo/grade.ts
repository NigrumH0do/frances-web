// Corrección del demo con la misma tolerancia que AI-09: mayúsculas,
// apóstrofos tipográficos, puntuación y espacios no cuentan; las tildes sí.

const APOSTROPHES = /[\u2018\u2019\u02bc`\u00b4]/g;
const NOISE = /[\p{P}\p{S}\s]+/gu;

function fold(value: string): string {
  return value
    .normalize('NFC')
    .toLocaleLowerCase('fr')
    .replace(APOSTROPHES, "'")
    .replace(NOISE, '');
}

export function gradeDemo(
  expected: string | string[],
  answer: string | string[],
): boolean {
  const left = (Array.isArray(expected) ? expected : [expected])
    .map(fold)
    .join('');
  const right = (Array.isArray(answer) ? answer : [answer]).map(fold).join('');
  return left === right;
}
