import { describe, expect, test } from 'vitest';
import { gradeDemo } from './grade';

describe('gradeDemo', () => {
  test('gradeDemo: tildes cuentan, apóstrofos y mayúsculas no', () => {
    expect(gradeDemo('où', 'ou')).toBe(false);
    expect(gradeDemo('ou', 'où')).toBe(false);
    expect(gradeDemo("l'ami", 'L’ami')).toBe(true);
    expect(gradeDemo(['Je', 'suis'], ['je', 'suis'])).toBe(true);
  });

  test('ignora puntuación, espacios y apóstrofos tipográficos', () => {
    expect(gradeDemo('Il fait beau.', ' il fait beau ')).toBe(true);
    expect(gradeDemo('«Bonjour !»', 'bonjour')).toBe(true);
    expect(gradeDemo("aujourd'hui", 'aujourd’hui')).toBe(true);
  });

  test('no reordena las respuestas de tipo ordenar', () => {
    expect(gradeDemo(['je', 'vais'], ['vais', 'je'])).toBe(false);
    expect(
      gradeDemo(['je', 'vais', 'à', "l'école"], ['Je', 'vais', 'à', 'l’école']),
    ).toBe(true);
  });

  test('acepta mayúsculas y NFC sin cambiar el orden de las palabras', () => {
    expect(gradeDemo('ÉCOLE', 'école')).toBe(true);
    expect(gradeDemo('e\u0301cole', 'école')).toBe(true);
  });
});
