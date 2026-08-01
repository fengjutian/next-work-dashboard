import React, { useRef } from 'react';
import { Button } from '@/components/ui/button';

interface DialogOverlayProps {
  dialog: { type: 'prompt'; title: string; defaultValue?: string; resolve: (value: string | null) => void } | { type: 'confirm'; message: string; resolve: (ok: boolean) => void } | null;
  onClose: () => void;
}

export const DialogOverlay: React.FC<DialogOverlayProps> = ({ dialog, onClose }) => {
  const inputRef = useRef<HTMLInputElement>(null);
  if (!dialog) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 pt-32" onMouseDown={() => dialog.type === 'confirm' && dialog.resolve(false)}>
      <div className="w-96 rounded-lg border bg-popover p-4 shadow-lg" onMouseDown={(e) => e.stopPropagation()}>
        <p className="mb-3 text-sm">{dialog.type === 'confirm' ? dialog.message : dialog.title}</p>
        {dialog.type === 'prompt' && <input ref={inputRef} defaultValue={dialog.defaultValue} onKeyDown={(e) => { if (e.key === 'Enter') { dialog.resolve(e.currentTarget.value); onClose(); } if (e.key === 'Escape') { dialog.resolve(null); onClose(); } }} className="mb-3 h-8 w-full rounded border bg-background px-2 text-sm outline-none" />}
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={() => { dialog.type === 'prompt' ? dialog.resolve(null) : dialog.resolve(false); onClose(); }}>取消</Button>
          <Button size="sm" onClick={() => { dialog.type === 'prompt' ? dialog.resolve(inputRef.current?.value ?? null) : dialog.resolve(true); onClose(); }}>确定</Button>
        </div>
      </div>
    </div>
  );
};
