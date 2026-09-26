import type { Question } from '@kaoyan408/shared';

export function toStudentQuestion(question: Question): Question {
  return {
    ...question,
    answer: '',
    analysis: question.type === '综合题' ? question.analysis : '',
    // V14-P0 (design §10.1): trap analyses reveal which options are wrong —
    // they are answer-revealing content and must never reach a pre-submission
    // student view. Explicit strip as a structural tripwire, independent of
    // whether upstream mappers currently populate the field.
    optionAnalyses: undefined,
  };
}

export function toStudentQuestions(questions: Question[]): Question[] {
  return questions.map(toStudentQuestion);
}
