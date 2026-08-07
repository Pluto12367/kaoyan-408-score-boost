import { useRef, type PropsWithChildren } from 'react';
import { useOverlayDialog } from '../hooks/useOverlayDialog';

interface OverlayDialogProps extends PropsWithChildren {
  label: string;
  onClose: () => void;
}

/** Full-screen modal wrapper with Escape-to-close and focus trapping. */
export function OverlayDialog({ label, onClose, children }: OverlayDialogProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  useOverlayDialog({ rootRef, onClose });
  return (
    <div ref={rootRef} className="exam-workspace-overlay" role="dialog" aria-modal="true" aria-label={label}>
      {children}
    </div>
  );
}
