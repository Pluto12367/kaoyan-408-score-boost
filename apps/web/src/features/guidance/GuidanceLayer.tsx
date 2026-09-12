import { useEffect, useMemo, useRef, useState } from 'react';
import {
  COMPLETION_BOUNDARY_NOTE,
  cooldownForTrigger,
  resolveFirstUseGuidance,
  type BehaviorSignal,
  type FirstUseFacts,
  type FirstUseFeatureKey,
  type GuidanceCandidate,
} from '@kaoyan408/shared';
import { isStaticDemoMode } from '../../api/env';
import { fetchPracticePatterns } from '../../api/endpoints/guidance';
import type { RoleSection } from '../../layouts/RoleNavigation';
import { ContextualHowCard, GuardrailCard, LearningContractCard } from './GuidanceCards';
import { useGuidanceDelivery } from './useGuidanceDelivery';

/**
 * G1.3 / G1.6 / G1.9 — the guidance container.
 *
 * Responsibilities, in order:
 *   1. read the behaviour-pattern signals (the one new backend read) and the
 *      contractual first-use facts passed in by the caller;
 *   2. apply cooldown / caps / priority through the shared selector;
 *   3. render at most one guardrail and one contextual guide on this surface.
 *
 * Failure discipline: a failed read, a missing store, or a muted student all
 * resolve to "render nothing" — guidance must never become an error banner
 * (the existing ProactiveCoachCard / sprite surfaces set this precedent).
 */

export interface GuidanceLayerProps {
  /** Facts about first use, derived from state the caller already has. */
  facts: FirstUseFacts;
  onNavigate: (section: RoleSection) => void;
  /** Where this instance renders, for telemetry and per-surface caps. */
  surface: 'home';
}

export function GuidanceLayer({ facts, onNavigate, surface }: GuidanceLayerProps) {
  const delivery = useGuidanceDelivery();
  const [signals, setSignals] = useState<BehaviorSignal[]>([]);
  const loaded = useRef(false);

  useEffect(() => {
    if (isStaticDemoMode() || loaded.current) return;
    loaded.current = true;
    fetchPracticePatterns()
      .then((result) => {
        if (!result.storeAvailable) return;
        setSignals(result.signals ?? []);
      })
      .catch(() => {
        // Silent: a guidance read failure is never a student-facing error.
      });
  }, []);

  const candidates: GuidanceCandidate[] = useMemo(
    () => signals.map((signal) => ({
      triggerId: signal.id,
      priority: signal.priority,
      cooldownDays: signal.cooldownDays || cooldownForTrigger(signal.id),
    })),
    [signals],
  );

  const allowed = delivery.selectForSurface(candidates, surface);
  const guardrail = useMemo(() => {
    const allowedIds = new Set(allowed.map((entry) => entry.triggerId));
    return signals.find((signal) => allowedIds.has(signal.id)) ?? null;
  }, [allowed, signals]);

  const seenFeatures: FirstUseFeatureKey[] = useMemo(() => {
    const keys: FirstUseFeatureKey[] = [];
    for (const key of ['first_diagnostic', 'first_practice', 'first_wrong_question', 'first_review', 'first_transfer_probe', 'first_mock_exam'] as FirstUseFeatureKey[]) {
      if (delivery.hasSeen(key)) keys.push(key);
    }
    return keys;
  }, [delivery]);

  const howGuide = useMemo(
    () => resolveFirstUseGuidance({ facts, seen: seenFeatures, muted: delivery.muted || Boolean(guardrail) }),
    [facts, seenFeatures, delivery.muted, guardrail],
  );

  const shownRef = useRef<string | null>(null);
  useEffect(() => {
    const id = guardrail?.id ?? howGuide?.featureKey ?? null;
    if (!id || shownRef.current === id) return;
    shownRef.current = id;
    delivery.markShown(id, surface, guardrail ? { priority: guardrail.priority } : {});
  }, [guardrail, howGuide, delivery, surface]);

  if (isStaticDemoMode()) return null;

  return (
    <div className="gd-layer" data-testid="guidance-layer">
      {!delivery.contractAccepted ? (
        <LearningContractCard onAccept={delivery.acceptContract} />
      ) : null}

      {guardrail ? (
        <GuardrailCard
          signal={guardrail}
          onNavigate={onNavigate}
          onAccept={() => delivery.reportAccepted(guardrail.id, guardrail.action.id, surface)}
          onDismiss={() => delivery.dismiss(guardrail.id, surface)}
        />
      ) : null}

      {howGuide ? (
        <ContextualHowCard
          guide={howGuide}
          onDismiss={() => delivery.dismiss(howGuide.featureKey, surface)}
        />
      ) : null}

      {!guardrail && !howGuide ? (
        <p className="gd-muted" data-testid="guidance-quiet">{COMPLETION_BOUNDARY_NOTE}</p>
      ) : null}
    </div>
  );
}
