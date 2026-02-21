import { useState, useRef, useEffect } from 'react';
import { useUpdateChallenge } from '../../hooks/useAdmin';

interface InlineThemeEditorProps {
  challengeId: number;
  theme: string | null;
}

export function InlineThemeEditor({ challengeId, theme }: InlineThemeEditorProps) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(theme ?? '');
  const inputRef = useRef<HTMLInputElement>(null);
  const updateMutation = useUpdateChallenge();

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const save = () => {
    const trimmed = value.trim();
    if (trimmed !== (theme ?? '')) {
      updateMutation.mutate({ id: challengeId, updates: { theme: trimmed || undefined } });
    }
    setEditing(false);
  };

  const cancel = () => {
    setValue(theme ?? '');
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === 'Enter') save();
          if (e.key === 'Escape') cancel();
        }}
        onClick={(e) => e.stopPropagation()}
        className="flex-1 min-w-0 px-1.5 py-0.5 font-editorial italic text-sm text-navy/80 bg-paper
                   border border-navy/20 rounded focus:border-navy/40 focus:outline-none"
      />
    );
  }

  return (
    <span
      onClick={(e) => {
        e.stopPropagation();
        setValue(theme ?? '');
        setEditing(true);
      }}
      className="flex-1 font-editorial italic text-sm text-navy/60 truncate min-w-0
                 cursor-text hover:text-navy/80 hover:underline hover:underline-offset-2
                 hover:decoration-navy/20 transition-colors"
      title="Click to edit theme"
    >
      {theme || '—'}
    </span>
  );
}
