import type { PracticeAnswerResult } from '../../api/endpoints/practice';

/**
 * V14-P0 (design §10.3) — pure view selection for post-answer trap analyses.
 *
 * Mirrors the CodeBrick-verified presentation shape: the trap for the option
 * the student actually chose ("你为什么会选 X") comes first, the remaining
 * wrong-option traps follow ("其他选项为什么错"). Correct answers never render
 * traps (there is nothing to explain away), and questions without authored
 * traps render nothing — absent/null must never become fabricated content
 * (RULE-06 parity: 未撰写 ≠ 空 ≠ 无陷阱).
 */
export interface TrapViewLine {
  letter: string;
  text: string;
}

export interface OptionTrapSelection {
  selected: TrapViewLine | null;
  others: TrapViewLine[];
}

export function selectOptionTraps(result: PracticeAnswerResult | null | undefined): OptionTrapSelection {
  const traps = result?.optionAnalyses?.traps;
  if (!traps || typeof traps !== 'object' || result?.correct) {
    return { selected: null, others: [] };
  }
  const selectedLetter = (result.selectedAnswer ?? '').trim();
  const selected: TrapViewLine | null = selectedLetter && traps[selectedLetter]
    ? { letter: selectedLetter, text: traps[selectedLetter] }
    : null;
  const others = Object.keys(traps)
    .sort()
    .filter((letter) => letter !== selectedLetter)
    .map((letter) => ({ letter, text: traps[letter] }));
  return { selected, others };
}

export function hasRenderableOptionTraps(result: PracticeAnswerResult | null | undefined): boolean {
  const selection = selectOptionTraps(result);
  return selection.selected !== null || selection.others.length > 0;
}
