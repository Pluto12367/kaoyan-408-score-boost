/**
 * V10-2 Sprite mood → visual mapping (pure, dependency-free).
 *
 * The constitution constrains the palette to semantic tokens: the orb core is
 * always the --primary family; the only tinted accent is a status dot drawn
 * from --success/--warning. Motion has exactly two levels (breath/pulse) and
 * is disabled globally under prefers-reduced-motion. Faces are drawn by the
 * parameterized SVG in SpriteWidget; this module only decides which variant.
 */

export type SpriteMood =
  | 'recovery'
  | 'concern'
  | 'celebrate'
  | 'rest'
  | 'streak'
  | 'encourage'
  | 'focused'
  | 'idle'
  | 'unknown';

export type SpriteFaceKind =
  | 'welcoming'
  | 'worried'
  | 'joy'
  | 'restful'
  | 'spark'
  | 'happy'
  | 'thinking'
  | 'breathing'
  | 'curious';

export interface SpriteVisual {
  readonly face: SpriteFaceKind;
  readonly dot: 'none' | 'success' | 'warning';
  readonly motion: 'none' | 'breath' | 'pulse';
  readonly orbClass: string;
  readonly moodLabel: string;
}

const VISUALS: Record<SpriteMood, SpriteVisual> = {
  recovery: { face: 'welcoming', dot: 'none', motion: 'breath', orbClass: 'sprite-orb--recovery', moodLabel: '欢迎回来' },
  concern: { face: 'worried', dot: 'warning', motion: 'none', orbClass: 'sprite-orb--concern', moodLabel: '温和提醒' },
  celebrate: { face: 'joy', dot: 'success', motion: 'pulse', orbClass: 'sprite-orb--celebrate', moodLabel: '值得庆祝' },
  rest: { face: 'restful', dot: 'success', motion: 'none', orbClass: 'sprite-orb--rest', moodLabel: '今日收官' },
  streak: { face: 'spark', dot: 'success', motion: 'none', orbClass: 'sprite-orb--streak', moodLabel: '节奏成型' },
  encourage: { face: 'happy', dot: 'none', motion: 'breath', orbClass: 'sprite-orb--encourage', moodLabel: '平和推进' },
  focused: { face: 'thinking', dot: 'none', motion: 'none', orbClass: 'sprite-orb--focused', moodLabel: '专注陪伴' },
  idle: { face: 'breathing', dot: 'none', motion: 'breath', orbClass: 'sprite-orb--idle', moodLabel: '安静在场' },
  unknown: { face: 'curious', dot: 'none', motion: 'none', orbClass: 'sprite-orb--unknown', moodLabel: '还不熟悉' },
};

const IDLE_FALLBACK = VISUALS.idle;

export function spriteVisual(mood: string): SpriteVisual {
  return VISUALS[mood as SpriteMood] ?? IDLE_FALLBACK;
}
