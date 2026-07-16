import type { Question } from '@kaoyan408/shared';

export function toStudentQuestion(question: Question): Question {
  return {
    ...question,
    answer: '',
    analysis: question.type === '综合题' ? question.analysis : '',
  };
}

export function toStudentQuestions(questions: Question[]): Question[] {
  return questions.map(toStudentQuestion);
}
