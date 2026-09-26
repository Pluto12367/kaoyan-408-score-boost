// V14-P0 R3 — 2022 草稿合并器。
import { draftsQ1toQ20 } from './real-exam-2022-drafts-q1-20.mjs';
import { draftsQ21toQ40 } from './real-exam-2022-drafts-q21-40.mjs';
import { draftsEssay } from './real-exam-2022-drafts-essay.mjs';

export const drafts = { ...draftsQ1toQ20, ...draftsQ21toQ40, ...draftsEssay };
