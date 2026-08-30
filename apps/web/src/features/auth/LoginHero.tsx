import { ArrowUpRight } from 'lucide-react';
import { AIVisual } from './AIVisual';
import { StatsCard } from './StatsCard';

export function LoginHero({ registration = false }: { registration?: boolean }) {
  return (
    <div className="auth-product-hero">
      <div className="auth-product-mark">
        <span className="auth-product-logo">408</span>
        <div>
          <strong>408 OS</strong>
          <small>LEARNING INTELLIGENCE</small>
        </div>
        <ArrowUpRight size={18} aria-hidden="true" />
      </div>

      <div className="auth-product-copy">
        <p className="auth-product-kicker">{registration ? 'YOUR LEARNING SPACE AWAITS' : 'YOUR ADAPTIVE STUDY SYSTEM'}</p>
        <h1 aria-label="AI 驱动的 408 学习操作系统">AI 驱动的 408<br />学习操作系统</h1>
        <p>{registration ? '你的学习空间即将创建，目标、节奏与起点都会成为 AI 学习陪伴的一部分。' : '基于 Student State 与 AI 推荐引擎，帮助学生建立个性化学习路径。'}</p>
      </div>

      <div className="auth-stats" aria-label="学习数据概览">
        <StatsCard value="152" label="距离考研" accent="violet" />
        <StatsCard value="87%" label="知识掌握" accent="cyan" />
        <StatsCard value="3240" label="累计训练题" accent="mint" />
      </div>

      <AIVisual />
      {registration ? <div className="auth-learning-pillars"><span>Knowledge</span><span>Study Plan</span><span>AI Coach</span></div> : null}
    </div>
  );
}
