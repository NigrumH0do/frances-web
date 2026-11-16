import type { Quiz } from '../../../contracts/generated';

// La pregunta tal como la sirve la API: nunca lleva `answer` ni `expected`.
export type QuizQuestion = Quiz['questions'][number];

export interface QuestionProps<T> {
  q: QuizQuestion;
  value: T;
  onChange: (value: T) => void;
}
