import { cn } from '../../lib/utils';

const STATUS_STYLES: Record<string, string> = {
  active: 'bg-emerald-500/15 text-emerald-700 border-emerald-500/30',
  scheduled: 'bg-blue-500/15 text-blue-700 border-blue-500/30',
  draft: 'bg-muted/15 text-muted border-muted/30',
  completed: 'bg-navy/10 text-navy/50 border-navy/10',
};

export function StatusBadge({ status }: { status: string }) {
  const style = STATUS_STYLES[status] ?? STATUS_STYLES.draft;
  return (
    <span className={cn(
      'inline-block px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase tracking-wider border',
      style,
    )}>
      {status}
    </span>
  );
}
