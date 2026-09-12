import { useMemo, useState, type ReactNode } from 'react';
import type {
  BehaviorSignal,
  GuidanceStatement,
  HowGuidance,
  NextActionSpec,
  PriorityReasonDetail,
  TodayMissionContract,
  VerificationView,
} from '@kaoyan408/shared';
import {
  AI_BOUNDARY_NOTE,
  LEARNING_CONTRACT,
  MASTERY_BOUNDARY_NOTE,
  PRIORITY_SCORE_NOTE,
  STATEMENT_KIND_LABEL,
} from '@kaoyan408/shared';
import type { RoleSection } from '../../layouts/RoleNavigation';
import './guidance.css';

/**
 * G1.2 / G1.3 / G1.4 / G1.5 / G1.6 — the guidance surface.
 *
 * Two rules govern every component here:
 *   1. Nothing is a toast. Every card either explains and offers a real,
 *      clickable entry point, or it does not render at all (task §7/§9).
 *   2. Every sentence carries its statement kind, so an inference can never be
 *      read as an observation (task §19).
 */

function StatementLine({ line }: { line: GuidanceStatement }) {
  return (
    <p className={`gd-statement gd-statement-${line.kind.toLowerCase()}`}>
      <span className="gd-kind">{STATEMENT_KIND_LABEL[line.kind]}</span>
      {line.text}
    </p>
  );
}

function ReasonList({ reasons, contextFacts }: {
  reasons: readonly PriorityReasonDetail[];
  contextFacts: readonly PriorityReasonDetail[];
}) {
  if (reasons.length === 0 && contextFacts.length === 0) return null;
  return (
    <div className="gd-reasons">
      {reasons.length > 0 ? (
        <>
          <p className="gd-label">为什么推荐</p>
          <ul className="gd-reason-list">
            {reasons.map((reason) => (
              <li key={reason.code} className={`gd-reason gd-reason-${reason.tier.toLowerCase()}`}>
                {reason.statement || reason.code}
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {contextFacts.length > 0 ? (
        <>
          <p className="gd-label">当前情况</p>
          <ul className="gd-reason-list gd-context-list">
            {contextFacts.map((fact) => (
              <li key={fact.code} className="gd-context">{fact.statement || fact.code}</li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}

function NextButton({ next, reason, onNavigate, onAccept, testId }: {
  next: NextActionSpec;
  reason: string;
  onNavigate: (section: RoleSection) => void;
  onAccept?: () => void;
  testId?: string;
}) {
  return (
    <div className="gd-next">
      <button
        type="button"
        className="primary-action gd-next-button"
        data-testid={testId}
        onClick={() => {
          onAccept?.();
          onNavigate(next.section);
        }}
      >
        {next.label}
      </button>
      <p className="gd-next-reason">{reason}</p>
    </div>
  );
}

// ------------------------------------------------------------- G1.2 TODAY

export interface PrimaryLearningActionCardProps {
  contract: TodayMissionContract;
  onNavigate: (section: RoleSection) => void;
  onStart?: () => void;
  onDismiss?: () => void;
  progressText?: string | null;
}

/**
 * The single primary learning action for today (task §4/§5, owner decision A4).
 * It is the only element on the home screen allowed to carry a filled primary
 * button for "start learning"; every other surface is demoted to Secondary or
 * Context by StudentHome.
 */
export function PrimaryLearningActionCard({
  contract, onNavigate, onStart, onDismiss, progressText,
}: PrimaryLearningActionCardProps) {
  const task = contract.what;
  return (
    <section className="gd-primary panel" aria-label="今天的主行动" data-testid="primary-learning-action">
      <div className="gd-primary-head">
        <div>
          <p className="eyebrow">今天的主行动</p>
          <h3>{task ? task.title : '今天还没有可执行的任务'}</h3>
        </div>
        <div className="gd-primary-head-right">
          <span className="gd-today">{contract.today}</span>
          {onDismiss ? (
            <button type="button" className="gd-dismiss" aria-label="收起主行动说明" onClick={onDismiss}>收起说明</button>
          ) : null}
        </div>
      </div>

      {task ? (
        <>
          <p className="gd-primary-meta">
            {task.subject}{task.chapter ? ` · ${task.chapter}` : ''}{contract.time ? ` · ${contract.time}` : ''}
            {progressText ? ` · ${progressText}` : ''}
          </p>

          <ReasonList reasons={contract.why} contextFacts={contract.context} />
          {!contract.whySufficient && contract.insufficientNote ? (
            <p className="gd-insufficient">{contract.insufficientNote}</p>
          ) : null}

          <div className="gd-verify">
            <p className="gd-label">做完之后系统会怎么验证</p>
            <p className="gd-verify-text">{contract.verify}</p>
          </div>

          {onStart ? (
            <button type="button" className="primary-action gd-start" onClick={onStart} data-testid="primary-action-start">
              开始这一步
            </button>
          ) : null}
        </>
      ) : (
        <p className="gd-primary-meta">系统不会为了填满页面而给你安排一个任务。</p>
      )}

      <NextButton next={contract.next} reason={contract.nextReason} onNavigate={onNavigate} />
      <p className="gd-boundary">{contract.boundary}</p>
    </section>
  );
}

// --------------------------------------------------------- G1.3 FIRST USE

export function ContextualHowCard({ guide, onDismiss }: { guide: HowGuidance; onDismiss: () => void }) {
  return (
    <section className="gd-how panel" aria-label="使用说明" data-testid={`how-${guide.featureKey}`}>
      <div className="gd-how-head">
        <div>
          <p className="eyebrow">第一次用到，先说明一下</p>
          <h3>{guide.title}</h3>
        </div>
        <button type="button" className="gd-dismiss" onClick={onDismiss}>知道了</button>
      </div>
      <StatementLine line={{ kind: 'FACT', text: guide.why }} />
      <p className="gd-label">怎么做才算做对</p>
      <ul className="gd-how-steps">
        {guide.how.map((step) => <li key={step}>{step}</li>)}
      </ul>
      <StatementLine line={{ kind: 'FACT', text: guide.after }} />
    </section>
  );
}

// ------------------------------------------------------- G1.4 VERIFICATION

export function VerificationBanner({
  view, onNavigate, onDismiss,
}: { view: VerificationView; onNavigate: (section: RoleSection) => void; onDismiss?: () => void }) {
  return (
    <section className="gd-verify-banner panel" aria-label="本次结果如何被验证" data-testid="verification-banner">
      <div className="gd-verify-banner-head">
        <h4>{view.heading}</h4>
        <span className="gd-kind">结果解读</span>
        {onDismiss ? <button type="button" className="gd-dismiss" onClick={onDismiss}>关闭</button> : null}
      </div>
      {view.facts.map((line) => <StatementLine key={line.text} line={line} />)}
      {view.meaning.map((line) => <StatementLine key={line.text} line={line} />)}
      <NextButton next={view.next} reason={view.nextReason} onNavigate={onNavigate} testId="verification-next" />
      <p className="gd-boundary">{view.boundary}</p>
    </section>
  );
}

// ---------------------------------------------------------- G1.6 GUARDRAIL

export function GuardrailCard({
  signal, onNavigate, onAccept, onDismiss,
}: {
  signal: BehaviorSignal;
  onNavigate: (section: RoleSection) => void;
  onAccept: () => void;
  onDismiss: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <section
      className={`gd-guardrail panel gd-guardrail-${signal.priority.toLowerCase()}`}
      aria-label="学习方式提醒"
      data-testid={`guardrail-${signal.id}`}
    >
      <div className="gd-guardrail-head">
        <h4>{signal.title}</h4>
        <button type="button" className="gd-dismiss" onClick={onDismiss}>不再提示</button>
      </div>
      <StatementLine line={signal.fact} />
      <StatementLine line={signal.inference} />
      {expanded ? (
        <p className="gd-guardrail-verify"><span className="gd-kind">怎么算改好了</span>{signal.verification}</p>
      ) : (
        <button type="button" className="gd-link" onClick={() => setExpanded(true)}>怎么算改好了？</button>
      )}
      <NextButton
        next={signal.action}
        reason={signal.verification}
        onNavigate={onNavigate}
        onAccept={onAccept}
        testId={`guardrail-action-${signal.id}`}
      />
    </section>
  );
}

// ------------------------------------------------------- LEARNING CONTRACT

export function LearningContractCard({ onAccept }: { onAccept: () => void }) {
  return (
    <section className="gd-contract panel" aria-label="408 提分系统使用约定" data-testid="learning-contract">
      <div className="gd-contract-head">
        <div>
          <p className="eyebrow">开始之前</p>
          <h3>这套系统的 7 条使用约定</h3>
        </div>
      </div>
      <ol className="gd-contract-list">
        {LEARNING_CONTRACT.map((line) => (
          <li key={line.text} className={`gd-contract-line gd-statement-${line.kind.toLowerCase()}`}>
            <span className="gd-kind">{STATEMENT_KIND_LABEL[line.kind]}</span>
            {line.text}
            <small className="gd-contract-hint">可以在「{line.evidenceHint}」核对</small>
          </li>
        ))}
      </ol>
      <button type="button" className="primary-action" onClick={onAccept} data-testid="learning-contract-accept">
        开始使用
      </button>
    </section>
  );
}

// --------------------------------------------------------------- boundaries

/** Small reusable boundary note so the discipline is not retyped per surface. */
export function BoundaryNote({ kind }: { kind: 'mastery' | 'ai' | 'priority' }) {
  const text = kind === 'mastery' ? MASTERY_BOUNDARY_NOTE : kind === 'ai' ? AI_BOUNDARY_NOTE : PRIORITY_SCORE_NOTE;
  return <p className="gd-boundary">{text}</p>;
}

/** Renders the FACT/INFERENCE/... chips a caller already computed. */
export function StatementStack({ lines }: { lines: readonly GuidanceStatement[] }) {
  const memo = useMemo(() => lines, [lines]);
  return <>{memo.map((line) => <StatementLine key={line.text} line={line} />)}</>;
}

export type { ReactNode };
