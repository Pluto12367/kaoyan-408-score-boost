// V14 内容生产轨 — 2019 草稿合并器（三份分片 → 泛型组装器期望的 { drafts } 形状）。
import { draftsQ1toQ20 } from './real-exam-2019-drafts-q1-20.mjs';
import { draftsQ21toQ40 } from './real-exam-2019-drafts-q21-40.mjs';
import { draftsEssay } from './real-exam-2019-drafts-essay.mjs';

export const drafts = { ...draftsQ1toQ20, ...draftsQ21toQ40, ...draftsEssay };
