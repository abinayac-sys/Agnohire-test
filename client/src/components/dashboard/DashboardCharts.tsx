import type { ReactNode } from 'react';
import { formatTitleCase } from '@agnohire/shared';
import { cn } from '../../utils/cn.js';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
} from 'recharts';
import type { TimeSeriesPoint, BreakdownSlice } from '@agnohire/shared';

/** Cohesive palette derived from the app theme tokens. */
export const CHART_COLORS = ['#6366f1', '#0ea5e9', '#059669', '#d97706', '#e11d48', '#818cf8', '#a5b4fc'];

const AXIS = '#8b94ab';
const GRID = '#e4e8f3';

const tooltipStyle = {
  borderRadius: 12,
  border: '1px solid #e4e8f3',
  background: '#ffffff',
  boxShadow: '0 4px 16px rgb(17 23 38 / 0.08)',
  fontSize: 12,
} as const;

/** Card shell with a header so every chart looks consistent. */
export function ChartCard({
  title,
  subtitle,
  action,
  children,
  className = '',
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-2xl border border-border bg-surface-raised p-5 shadow-elev-1 ${className}`}>
      <div className="mb-4 flex items-start justify-between gap-2">
        <div>
          <h3 className="font-heading text-sm font-semibold text-text-primary">{title}</h3>
          {subtitle && <p className="text-xs text-text-muted">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

function Empty({ height }: { height: number }) {
  return (
    <div className="flex items-center justify-center text-sm text-text-muted" style={{ height }}>
      No data for this range yet.
    </div>
  );
}

const shortDate = (d: string) =>
  new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

/** Stacked area chart of applications / interviews / hires over time. */
export function ActivityAreaChart({ data, height = 300 }: { data: TimeSeriesPoint[]; height?: number }) {
  const total = data.reduce((s, p) => s + p.applications + p.interviews + p.hires, 0);
  if (!data.length || total === 0) return <Empty height={height} />;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
        <defs>
          {['applications', 'interviews', 'hires'].map((k, i) => (
            <linearGradient key={k} id={`g-${k}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={CHART_COLORS[i]} stopOpacity={0.35} />
              <stop offset="100%" stopColor={CHART_COLORS[i]} stopOpacity={0.02} />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
        <XAxis dataKey="date" tickFormatter={shortDate} tick={{ fontSize: 11, fill: AXIS }} stroke={GRID} minTickGap={24} />
        <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: AXIS }} stroke={GRID} width={48} />
        <Tooltip contentStyle={tooltipStyle} labelFormatter={(d) => shortDate(String(d))} />
        <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
        <Area type="monotone" dataKey="applications" stroke={CHART_COLORS[0]} fill="url(#g-applications)" strokeWidth={2} />
        <Area type="monotone" dataKey="interviews" stroke={CHART_COLORS[1]} fill="url(#g-interviews)" strokeWidth={2} />
        <Area type="monotone" dataKey="hires" stroke={CHART_COLORS[2]} fill="url(#g-hires)" strokeWidth={2} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/** Donut chart for a categorical breakdown, with a legend + total in the center. */
export function DonutChart({ data, height = 240 }: { data: BreakdownSlice[]; height?: number }) {
  if (!data.length) return <Empty height={height} />;
  const total = data.reduce((s, d) => s + d.count, 0);
  return (
    <div className="flex items-center gap-4">
      <div className="relative shrink-0" style={{ width: height, height, minWidth: height }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="count" nameKey="label" innerRadius={height * 0.31} outerRadius={height * 0.5} paddingAngle={2} stroke="none">
              {data.map((_, i) => (
                <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
              ))}
            </Pie>
            <Tooltip contentStyle={tooltipStyle} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span
            className="text-2xl font-bold text-text-primary"
            style={{ fontFamily: 'var(--app-font-family)' }}
          >{total}</span>
          <span className="text-[11px] uppercase tracking-wide text-text-muted">Total</span>
        </div>
      </div>
      <ul className={cn('min-w-0 flex-1', data.length > 5 ? 'space-y-1' : 'space-y-1.5')}>
        {data.map((d, i) => (
          <li
            key={d.label}
            className={cn('flex items-center justify-between gap-2', data.length > 5 ? 'text-xs' : 'text-sm')}
          >
            <span className="flex min-w-0 items-center gap-2">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} />
              <span className="break-words capitalize leading-tight text-text-secondary">{formatTitleCase(d.label)}</span>
            </span>
            <span className="shrink-0 font-medium text-text-primary">{d.count}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Horizontal bar chart for ranked breakdowns. */
export function HBarChart({ data, height = 240, color = CHART_COLORS[0] }: { data: BreakdownSlice[]; height?: number; color?: string }) {
  if (!data.length) return <Empty height={height} />;
  const rows = data.map((d) => ({ ...d, name: d.label.toLowerCase().replace(/_/g, ' ') }));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 4 }} barCategoryGap={10}>
        <CartesianGrid strokeDasharray="3 3" stroke={GRID} horizontal={false} />
        <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: AXIS }} stroke={GRID} />
        <YAxis type="category" dataKey="name" tick={{ fontSize: 12, fill: AXIS }} stroke={GRID} width={96} />
        <Tooltip contentStyle={tooltipStyle} cursor={{ fill: '#eef0fe' }} />
        <Bar dataKey="count" radius={[0, 6, 6, 0]} barSize={18}>
          {rows.map((_, i) => (
            <Cell key={i} fill={data.length > 1 ? CHART_COLORS[i % CHART_COLORS.length] : color} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
