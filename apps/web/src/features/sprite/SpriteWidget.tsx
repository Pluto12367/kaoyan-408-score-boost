import { useCallback, useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { API_BASE_URL, fetchWithAuth } from '../../api/client';
import { isStaticDemoMode } from '../../api/env';
import { trackEvent } from '../../api/events';
import { spriteVisual, type SpriteFaceKind } from './spriteMood';
import {
  useSpriteState,
  readBubbleQuotaUsed,
  consumeBubbleQuota,
  type SpriteEvidenceRefView,
  type SpriteLineView,
} from './useSpriteState';
import './sprite.css';

/**
 * V10-2/3/4/5 — the companion's ambient surface (constitution §5.3/§7.3/§4).
 *
 * Honesty: static demo mode and hard fetch failures render nothing (V9
 * ProactiveCoachCard precedent — the sprite never becomes an error banner);
 * API-level degradation arrives as the backend's own honest lines. Every line
 * exposes its evidence ("依据"); deep links reuse the canonical surfaces.
 * V10-3 adds the companion loop: ONE proactive bubble per natural day
 * (muted users are never interrupted; idle/focused never greet). V10-4 adds
 * the "星野记得" user-stated memory (add / forget — always user-controlled).
 * V10-5 adds the conversation, riding the existing supervisor with honest
 * per-agent rendering; every user message reflows through the deterministic
 * memory extractor (best-effort).
 */

const EVIDENCE_SOURCE_LABELS: Record<string, string> = {
  student_context: '学习档案',
  today_plan: '今日计划',
  proactive: '风险提醒',
  progress_story: '进步叙事',
  recovery: '断档恢复',
  session: '练习会话',
};

interface SpriteChatMessage {
  id: string;
  role: 'user' | 'sprite';
  text: string;
  error?: boolean;
  meta?: {
    routedTo?: string;
    mode?: string;
    suggestions?: string[];
    citations?: string[];
    link?: { target: string; label: string };
  };
}

function adaptSupervisorReply(result: {
  ok?: boolean;
  routedTo?: string;
  error?: string;
  citations?: readonly string[];
  data?: {
    mode?: string;
    answer?: { summary?: string; suggestions?: string[] };
  };
}): SpriteChatMessage {
  const id = `s-${Date.now()}`;
  const routedTo = String(result?.routedTo ?? '');
  const citations = Array.isArray(result?.citations) ? result.citations.map(String) : [];
  if (!result || result.ok !== true) {
    return {
      id,
      role: 'sprite',
      text: `对话失败：${result?.error ?? '未知错误'}。稍后再试一次。`,
      error: true,
      meta: { routedTo },
    };
  }
  if (routedTo === 'tutor-agent') {
    // Constitution §4.2: solutions live in the tutor surface, not inline here.
    return {
      id,
      role: 'sprite',
      text: '这个问题值得进入讲解模式，我陪你一步步来。',
      meta: { routedTo, link: { target: '#/ai', label: '去 AI 答疑' } },
    };
  }
  if (routedTo === 'planner-agent') {
    return {
      id,
      role: 'sprite',
      text: '计划草案已生成（默认只预览，不写入你的计划）。',
      meta: { routedTo, link: { target: '#/dashboard', label: '看今日计划' } },
    };
  }
  if (routedTo === 'exam-agent') {
    return {
      id,
      role: 'sprite',
      text: '模拟卷已备好——真实题库、真实知识节点。',
      meta: { routedTo, citations, link: { target: '#/test', label: '去测试' } },
    };
  }
  const answer = result.data?.answer ?? {};
  const summary = String(answer.summary ?? '').trim()
    || '这一轮我没有形成有依据的回答，换个问法试试。';
  return {
    id,
    role: 'sprite',
    text: summary,
    meta: {
      routedTo,
      mode: String(result.data?.mode ?? ''),
      suggestions: Array.isArray(answer.suggestions) ? answer.suggestions.map(String).slice(0, 3) : [],
      citations,
    },
  };
}

function SpriteFace({ face }: { face: SpriteFaceKind }) {
  const stroke = 'currentColor';
  const roundEyes = (
    <>
      <circle cx="12.4" cy="14" r="1.5" fill={stroke} />
      <circle cx="19.6" cy="14" r="1.5" fill={stroke} />
    </>
  );
  const arcEyes = (
    <>
      <path d="M10.6 14.4 Q12.4 12.4 14.2 14.4" fill="none" stroke={stroke} strokeWidth="1.4" strokeLinecap="round" />
      <path d="M17.8 14.4 Q19.6 12.4 21.4 14.4" fill="none" stroke={stroke} strokeWidth="1.4" strokeLinecap="round" />
    </>
  );
  switch (face) {
    case 'joy':
      return (
        <>
          {arcEyes}
          <path d="M12.5 18.6 Q16 21.8 19.5 18.6 Q16 20.2 12.5 18.6 Z" fill={stroke} />
        </>
      );
    case 'restful':
      return (
        <>
          <path d="M10.6 14 Q12.4 15.8 14.2 14" fill="none" stroke={stroke} strokeWidth="1.4" strokeLinecap="round" />
          <path d="M17.8 14 Q19.6 15.8 21.4 14" fill="none" stroke={stroke} strokeWidth="1.4" strokeLinecap="round" />
          <path d="M13.4 19 Q16 20.6 18.6 19" fill="none" stroke={stroke} strokeWidth="1.4" strokeLinecap="round" />
        </>
      );
    case 'worried':
      return (
        <>
          <path d="M10.8 12.6 L14 13.8" stroke={stroke} strokeWidth="1.4" strokeLinecap="round" />
          <path d="M21.2 12.6 L18 13.8" stroke={stroke} strokeWidth="1.4" strokeLinecap="round" />
          {roundEyes}
          <path d="M13.6 19.4 L18.4 19.4" fill="none" stroke={stroke} strokeWidth="1.4" strokeLinecap="round" />
        </>
      );
    case 'welcoming':
      return (
        <>
          <path d="M10.6 14 Q12.4 12.2 14.2 14" fill="none" stroke={stroke} strokeWidth="1.4" strokeLinecap="round" />
          <circle cx="19.6" cy="14" r="1.5" fill={stroke} />
          <path d="M13.4 18.8 Q16 21 18.6 18.8" fill="none" stroke={stroke} strokeWidth="1.4" strokeLinecap="round" />
        </>
      );
    case 'thinking':
      return (
        <>
          <path d="M10.8 14 L14 14" stroke={stroke} strokeWidth="1.6" strokeLinecap="round" />
          <path d="M18 14 L21.2 14" stroke={stroke} strokeWidth="1.6" strokeLinecap="round" />
          <path d="M13.8 19 Q16 18.4 18.2 19" fill="none" stroke={stroke} strokeWidth="1.4" strokeLinecap="round" />
        </>
      );
    case 'curious':
      return (
        <>
          {roundEyes}
          <path d="M13 19 Q14.5 18 16 19 Q17.5 20 19 19" fill="none" stroke={stroke} strokeWidth="1.4" strokeLinecap="round" />
        </>
      );
    case 'spark':
      return (
        <>
          {arcEyes}
          <path d="M13.4 18.4 Q16 20.8 18.6 18.4" fill="none" stroke={stroke} strokeWidth="1.4" strokeLinecap="round" />
          <path d="M25 8.5 L25 11.5 M23.5 10 L26.5 10" stroke={stroke} strokeWidth="1.3" strokeLinecap="round" />
          <path d="M7 9.5 L7 12 M5.5 10.75 L8.5 10.75" stroke={stroke} strokeWidth="1.3" strokeLinecap="round" />
        </>
      );
    case 'happy':
      return (
        <>
          {roundEyes}
          <path d="M13 18.4 Q16 21 19 18.4" fill="none" stroke={stroke} strokeWidth="1.4" strokeLinecap="round" />
        </>
      );
    case 'breathing':
    default:
      return (
        <>
          {roundEyes}
          <path d="M13.4 18.8 Q16 20.4 18.6 18.8" fill="none" stroke={stroke} strokeWidth="1.4" strokeLinecap="round" />
        </>
      );
  }
}

function LineEvidence({ refs }: { refs: readonly SpriteEvidenceRefView[] }) {
  return (
    <ul className="sprite-evidence">
      {refs.map((ref, index) => (
        <li key={`${ref.source}.${ref.field}.${index}`}>
          <span className="sprite-evidence-source">{EVIDENCE_SOURCE_LABELS[ref.source] ?? ref.source}</span>
          <span>{ref.detail}</span>
        </li>
      ))}
    </ul>
  );
}

function SpriteLineItem({ line, mood }: { line: SpriteLineView; mood: string }) {
  const [showEvidence, setShowEvidence] = useState(false);
  return (
    <li className={`sprite-line tone-${line.tone}`}>
      <p className="sprite-line-text">{line.text}</p>
      <div className="sprite-line-meta">
        <button
          type="button"
          className="sprite-chip"
          aria-expanded={showEvidence}
          onClick={() => setShowEvidence((previous) => !previous)}
        >
          依据
        </button>
        {line.action ? (
          <button
            type="button"
            className="sprite-chip sprite-chip--primary"
            onClick={() => {
              void trackEvent('sprite.interact', { action: 'action_click', mood, target: line.action!.target });
              window.location.hash = line.action!.target;
            }}
          >
            {line.action.label}
          </button>
        ) : null}
      </div>
      {showEvidence ? <LineEvidence refs={line.evidenceRefs} /> : null}
    </li>
  );
}

export function SpriteWidget({ accountKey }: { accountKey: string | null }) {
  const { state, muted, toggleMuted } = useSpriteState(accountKey);
  const [open, setOpen] = useState(false);
  const [bubbleOpen, setBubbleOpen] = useState(false);
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const greetedRef = useRef(false);
  const prevMoodRef = useRef<string | null>(null);

  // V10-4 memory + V10-5 conversation are panel-local state.
  const [memoryEntries, setMemoryEntries] = useState<{ id: string; text: string }[] | null>(null);
  const [memoryError, setMemoryError] = useState(false);
  const [memoryInput, setMemoryInput] = useState('');
  const [chat, setChat] = useState<SpriteChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    const onPointerDown = (event: PointerEvent) => {
      if (surfaceRef.current && !surfaceRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open]);

  // V10-3 companion loop: the greeting fires on the first state arrival; a
  // completion response fires when a refresh transitions the mood into
  // celebrate/rest. Both share the one-bubble-per-natural-day quota, both are
  // muted-gated, and idle/focused never greet.
  useEffect(() => {
    if (!state) {
      prevMoodRef.current = null;
      return;
    }
    if (muted) {
      setBubbleOpen(false);
      return;
    }
    const previous = prevMoodRef.current;
    prevMoodRef.current = state.mood;
    const eligible = state.lines.length > 0 && state.mood !== 'idle' && state.mood !== 'focused';
    if (!eligible) return;
    const isGreeting = !greetedRef.current;
    const isCompletion = previous !== null && previous !== state.mood && (state.mood === 'celebrate' || state.mood === 'rest');
    if (!isGreeting && !isCompletion) return;
    if (readBubbleQuotaUsed()) return;
    greetedRef.current = true;
    consumeBubbleQuota();
    setBubbleOpen(true);
    void trackEvent('sprite.interact', {
      action: 'bubble_shown',
      mood: state.mood,
      kind: isGreeting ? 'greeting' : 'completion',
    });
  }, [state, muted]);

  useEffect(() => {
    if (!bubbleOpen) return;
    const timer = window.setTimeout(() => setBubbleOpen(false), 8000);
    return () => window.clearTimeout(timer);
  }, [bubbleOpen]);

  useEffect(() => {
    greetedRef.current = false;
    setChat([]);
  }, [accountKey]);

  const loadMemory = useCallback(async () => {
    try {
      const response = await fetchWithAuth(`${API_BASE_URL}/sprite/memory`);
      if (!response.ok) {
        setMemoryError(true);
        return;
      }
      const payload = (await response.json()) as { entries?: { id: string; text: string }[] };
      setMemoryEntries(Array.isArray(payload.entries) ? payload.entries : []);
      setMemoryError(false);
    } catch {
      setMemoryError(true);
    }
  }, []);

  useEffect(() => {
    if (open) void loadMemory();
  }, [open, loadMemory]);

  const forgetMemory = async (memoryId: string) => {
    try {
      await fetchWithAuth(`${API_BASE_URL}/sprite/memory/${encodeURIComponent(memoryId)}`, { method: 'DELETE' });
    } catch {
      // reload below will surface the truth
    }
    void loadMemory();
  };

  const rememberText = async (rawText: string): Promise<boolean> => {
    const text = rawText.trim();
    if (!text) return false;
    try {
      const response = await fetchWithAuth(`${API_BASE_URL}/sprite/memory`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (!response.ok) {
        setMemoryError(true);
        return false;
      }
      void loadMemory();
      return true;
    } catch {
      setMemoryError(true);
      return false;
    }
  };

  const rememberManual = async () => {
    if (await rememberText(memoryInput)) setMemoryInput('');
  };

  const sendChat = async () => {
    const text = chatInput.trim();
    if (!text || sending) return;
    setChatInput('');
    setSending(true);
    setChat((previous) => [...previous, { id: `u-${Date.now()}`, role: 'user', text }]);
    // V10-4 reflow: user statements flow through the deterministic extractor.
    void rememberText(text);
    try {
      const response = await fetchWithAuth(`${API_BASE_URL}/agent/supervisor/run`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: text }),
      });
      const result = await response.json();
      setChat((previous) => [...previous, adaptSupervisorReply(result)]);
    } catch {
      setChat((previous) => [
        ...previous,
        { id: `e-${Date.now()}`, role: 'sprite', text: '对话失败：暂时连不上星野的大脑，稍后再试试。', error: true },
      ]);
    } finally {
      setSending(false);
    }
  };

  if (isStaticDemoMode()) return null;
  if (!state || !state.presence.visible) return null;

  const visual = spriteVisual(state.mood);
  const quiet = state.presence.mode === 'quiet';

  const togglePanel = () => {
    setOpen((previous) => {
      const next = !previous;
      if (next) {
        void trackEvent('sprite.interact', { action: 'panel_open', mood: state.mood });
        setBubbleOpen(false);
      }
      return next;
    });
  };

  return (
    <div className={`sprite-fab${open ? ' sprite-fab--open' : ''}`} ref={surfaceRef}>
      {open ? (
        <section className="sprite-panel" role="dialog" aria-label="AI 学习精灵 星野">
          <header className="sprite-panel-head">
            <div>
              <p className="sprite-panel-kicker">AI Companion</p>
              <h3 className="sprite-panel-title">星野 · {visual.moodLabel}</h3>
            </div>
            <button type="button" className="sprite-chip" aria-label="收起精灵面板" onClick={() => setOpen(false)}>
              <X size={14} aria-hidden="true" />
            </button>
          </header>
          <p className="sprite-panel-detail">{state.moodReason.detail}</p>
          <ul className="sprite-lines">
            {state.lines.map((line) => (
              <SpriteLineItem key={line.id} line={line} mood={state.mood} />
            ))}
          </ul>
          {state.bond.milestones.length > 0 ? (
            <div className="sprite-milestones">
              <p className="sprite-milestones-title">成就</p>
              <ul>
                {state.bond.milestones.map((milestone) => (
                  <li key={milestone.kind}>{milestone.label}</li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="sprite-memory">
            <p className="sprite-milestones-title">星野记得</p>
            {memoryError ? <p className="sprite-memory-status">记忆暂不可用，稍后再试。</p> : null}
            {memoryEntries && memoryEntries.length > 0 ? (
              <ul className="sprite-memory-list">
                {memoryEntries.map((item) => (
                  <li key={item.id}>
                    <span>{item.text}</span>
                    <button type="button" className="sprite-chip" onClick={() => void forgetMemory(item.id)}>
                      忘记
                    </button>
                  </li>
                ))}
              </ul>
            ) : !memoryError ? (
              <p className="sprite-memory-status">还没有关于你的记忆——跟我说说吧。</p>
            ) : null}
            <div className="sprite-memory-add">
              <input
                value={memoryInput}
                maxLength={120}
                placeholder="告诉星野一件关于你的事"
                onChange={(event) => setMemoryInput(event.target.value)}
              />
              <button type="button" className="sprite-chip" onClick={() => void rememberManual()}>
                记住
              </button>
            </div>
          </div>
          <div className="sprite-chat">
            <p className="sprite-milestones-title">问星野</p>
            <div className="sprite-chat-log">
              {chat.length === 0 ? (
                <p className="sprite-memory-status">考试、计划、讲解——说什么都可以，我来路由。</p>
              ) : null}
              {chat.map((message) => (
                <div
                  key={message.id}
                  className={`sprite-chat-msg sprite-chat-msg--${message.role}${message.error ? ' sprite-chat-msg--error' : ''}`}
                >
                  <p>{message.text}</p>
                  {message.meta?.mode === 'workflow' ? (
                    <small>确定性模式（AI 暂不可用，回答仍基于你的真实数据）</small>
                  ) : null}
                  {message.meta?.suggestions && message.meta.suggestions.length > 0 ? (
                    <div className="sprite-chat-suggestions">
                      {message.meta.suggestions.map((suggestion) => (
                        <span key={suggestion}>{suggestion}</span>
                      ))}
                    </div>
                  ) : null}
                  {message.meta?.citations && message.meta.citations.length > 0 ? (
                    <small className="sprite-chat-citations">依据节点：{message.meta.citations.join('、')}</small>
                  ) : null}
                  {message.meta?.link ? (
                    <button
                      type="button"
                      className="sprite-chip"
                      onClick={() => {
                        window.location.hash = message.meta!.link!.target;
                      }}
                    >
                      {message.meta.link.label}
                    </button>
                  ) : null}
                </div>
              ))}
              {sending ? <p className="sprite-memory-status">星野思考中…</p> : null}
            </div>
            <div className="sprite-chat-input">
              <input
                value={chatInput}
                maxLength={500}
                placeholder="问点什么…"
                onChange={(event) => setChatInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void sendChat();
                }}
              />
              <button
                type="button"
                className="sprite-chip sprite-chip--primary"
                disabled={sending}
                onClick={() => void sendChat()}
              >
                发送
              </button>
            </div>
          </div>
          <footer className="sprite-panel-foot">
            <button
              type="button"
              className="sprite-chip sprite-mute"
              aria-pressed={muted}
              onClick={toggleMuted}
            >
              {muted ? '免打扰已开启（不会主动打扰）' : '免打扰（不主动弹泡）'}
            </button>
          </footer>
        </section>
      ) : null}
      {bubbleOpen && state.lines.length > 0 ? (
        <div className="sprite-bubble" role="status">
          <div className="sprite-bubble-head">
            <strong>星野 · {visual.moodLabel}</strong>
            <button
              type="button"
              className="sprite-chip"
              aria-label="关闭问候"
              onClick={() => setBubbleOpen(false)}
            >
              <X size={12} aria-hidden="true" />
            </button>
          </div>
          <button
            type="button"
            className="sprite-bubble-body"
            onClick={() => {
              void trackEvent('sprite.interact', { action: 'bubble_click', mood: state.mood });
              setBubbleOpen(false);
              togglePanel();
            }}
          >
            <span>{state.lines[0].text}</span>
            <span className="sprite-bubble-cta">查看</span>
          </button>
        </div>
      ) : null}
      <button
        type="button"
        className={`sprite-orb motion-${visual.motion} ${visual.orbClass}${quiet ? ' sprite-orb--quiet' : ''}`}
        aria-expanded={open}
        aria-label="AI 学习精灵 星野"
        onClick={togglePanel}
      >
        <span className="sprite-orb-core">
          <svg viewBox="0 0 32 32" aria-hidden="true" focusable="false">
            <SpriteFace face={visual.face} />
          </svg>
        </span>
        {visual.dot !== 'none' ? <span className={`sprite-orb-dot sprite-orb-dot--${visual.dot}`} aria-hidden="true" /> : null}
      </button>
    </div>
  );
}
