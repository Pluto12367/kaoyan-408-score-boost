import type { CatalogTrendDirection, SubjectCode } from '@kaoyan408/shared';
import type { NodeMasteryStatus } from '../../api/endpoints/score-center';

export const SUBJECT_NAMES: Record<SubjectCode, string> = {
  DS: '数据结构',
  CO: '计算机组成原理',
  OS: '操作系统',
  CN: '计算机网络',
};

export const SUBJECT_ORDER: SubjectCode[] = ['DS', 'CO', 'OS', 'CN'];

export const TREND_LABELS: Record<CatalogTrendDirection, string> = {
  rising: '上升',
  stable: '稳定',
  falling: '下降',
  cold: '冷门/暂无明显趋势',
};

export const ALL_TIME_EVIDENCE_LABEL = '长期考频证据';
export const NO_FREQUENCY_LABEL = '暂无考频数据';

export const MASTERY_STATUS_LABELS: Record<NodeMasteryStatus, string> = {
  untouched: '未学习',
  weak: '薄弱',
  review: '复习中',
  mastered: '已掌握',
};
