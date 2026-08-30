import { BrainCircuit, DatabaseZap, Network, Sparkles } from 'lucide-react';

export function AIVisual() {
  return (
    <div className="auth-ai-visual" aria-hidden="true">
      <div className="auth-ai-plane" />
      <div className="auth-ai-orbit auth-ai-orbit-outer" />
      <div className="auth-ai-orbit auth-ai-orbit-inner" />
      <span className="auth-ai-path auth-ai-path-one" />
      <span className="auth-ai-path auth-ai-path-two" />
      <span className="auth-ai-path auth-ai-path-three" />
      <div className="auth-ai-core">
        <BrainCircuit size={34} strokeWidth={1.6} />
        <span>AI CORE</span>
      </div>
      <div className="auth-ai-node auth-ai-node-state"><DatabaseZap size={18} /><span>Student State</span></div>
      <div className="auth-ai-node auth-ai-node-map"><Network size={18} /><span>Knowledge Map</span></div>
      <div className="auth-ai-node auth-ai-node-plan"><Sparkles size={18} /><span>Adaptive Plan</span></div>
      <div className="auth-ai-readout">
        <span>LEARNING SIGNAL</span>
        <strong>87.4</strong>
        <i />
      </div>
    </div>
  );
}
