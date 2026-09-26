// V14-P0 — 2026 草稿合并器：三份分片草稿（R2 拆分写入）合并为泛型组装器
// 期望的单模块形状 { drafts }。内容不变，仅形状适配。
import { draftsQ1toQ20 } from './real-exam-2026-drafts-q1-20.mjs';
import { draftsQ21toQ40 } from './real-exam-2026-drafts-q21-40.mjs';
import { draftsEssay } from './real-exam-2026-drafts-essay.mjs';

export const drafts = { ...draftsQ1toQ20, ...draftsQ21toQ40, ...draftsEssay };
