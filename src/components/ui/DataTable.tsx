import { useMemo, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { cn } from '@/lib/cn';

export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  /** Sort value; null/undefined always sorts last (unknown is not zero). */
  sort?: (row: T) => number | string | null | undefined;
  align?: 'left' | 'right';
  className?: string;
  /** Keep the column narrow and unwrapped (numbers, chips). */
  nowrap?: boolean;
}

/**
 * Accessible data table: a real <table> with a caption, sortable column
 * headers (aria-sort), and a bounded horizontal scroll container so a wide
 * table never widens the page.
 */
export function DataTable<T>({ columns, rows, rowKey, caption, captionHidden = false, empty, initialSort, onRowClick, rowClassName, minWidth, className, dense = false }: { columns: Array<Column<T>>; rows: T[]; rowKey: (row: T) => string; caption: string; captionHidden?: boolean; empty?: ReactNode; initialSort?: { key: string; dir: 'asc' | 'desc' }; onRowClick?: (row: T) => void; rowClassName?: (row: T) => string | undefined; minWidth?: number; className?: string; dense?: boolean }) {
  const [sort, setSort] = useState(initialSort || null);
  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.sort) return rows;
    const val = col.sort;
    return [...rows].sort((a, b) => {
      const x = val(a);
      const y = val(b);
      if (x === null || x === undefined) return y === null || y === undefined ? 0 : 1;
      if (y === null || y === undefined) return -1;
      const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y));
      return sort.dir === 'asc' ? c : -c;
    });
  }, [rows, sort, columns]);

  return (
    <div className={cn('scrollbar-thin max-w-full overflow-x-auto', className)}>
      <table className="w-full border-collapse text-left" style={minWidth ? { minWidth } : undefined}>
        <caption className={cn('pb-2 text-left text-[12px] text-subtle', captionHidden && 'sr-only')}>{caption}</caption>
        <thead>
          <tr>
            {columns.map((c) => {
              const active = sort?.key === c.key;
              const ariaSort = active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : c.sort ? 'none' : undefined;
              return (
                <th key={c.key} scope="col" aria-sort={ariaSort} className={cn('border-b border-line py-2 pr-4 text-[11px] font-medium uppercase tracking-[0.06em] text-subtle', c.align === 'right' && 'text-right', c.className)}>
                  {c.sort ? (
                    <button type="button" onClick={() => setSort({ key: c.key, dir: active && sort!.dir === 'desc' ? 'asc' : 'desc' })} className={cn('inline-flex items-center gap-1 rounded-sm uppercase transition-control hover:text-ink', active && 'text-ink')}>
                      {c.header}
                      {active ? sort!.dir === 'asc' ? <ArrowUp size={11} aria-hidden /> : <ArrowDown size={11} aria-hidden /> : <ArrowUpDown size={11} aria-hidden className="opacity-50" />}
                    </button>
                  ) : (
                    c.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => (
            <tr key={rowKey(row)} onClick={onRowClick ? () => onRowClick(row) : undefined} className={cn(onRowClick && 'cursor-pointer transition-colors hover:bg-ink/[0.025]', rowClassName?.(row))}>
              {columns.map((c) => (
                <td key={c.key} className={cn('border-b border-line pr-4 align-top text-[13px] text-ink', dense ? 'py-2' : 'py-2.5', c.align === 'right' && 'text-right tnum', c.nowrap && 'whitespace-nowrap', c.className)}>
                  {c.cell(row)}
                </td>
              ))}
            </tr>
          ))}
          {!sorted.length && (
            <tr>
              <td colSpan={columns.length} className="py-8 text-center text-[13px] text-subtle">
                {empty || 'Nothing to show.'}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
