import { useState, useEffect } from 'react';
import { Select } from '../ui/Select.js';

interface Props {
  from?: string;
  to?: string;
  onChange: (from?: string, to?: string) => void;
}

const RANGE_OPTIONS = [
  { value: 'all', label: 'All time' },
  { value: '0', label: 'Today' },
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
  { value: '365', label: 'Last 12 months' },
  { value: 'custom', label: 'Custom' },
];

function isoDaysAgo(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

export function DateRangeFilter({ from, to, onChange }: Props) {
  const [mode, setMode] = useState('all');
  const [customRange, setCustomRange] = useState({
    from: new Date().toISOString().slice(0, 10),
    to: new Date().toISOString().slice(0, 10),
  });
  
  // Sync prop changes (e.g. cleared filters) back to internal state
  useEffect(() => {
    if (!from && !to) {
      setMode('all');
    }
  }, [from, to]);

  const handleModeChange = (newMode: string) => {
    setMode(newMode);
    if (newMode === 'all') {
      onChange(undefined, undefined);
    } else if (newMode === 'custom') {
      onChange(customRange.from, customRange.to);
    } else {
      const days = Number(newMode);
      onChange(isoDaysAgo(days), new Date().toISOString().slice(0, 10));
    }
  };

  const handleCustomChange = (type: 'from' | 'to', val: string) => {
    const next = { ...customRange, [type]: val };
    setCustomRange(next);
    if (mode === 'custom') {
      onChange(next.from, next.to);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <Select 
        className="w-36" 
        options={RANGE_OPTIONS} 
        value={mode} 
        onChange={e => handleModeChange(e.target.value)} 
      />
      {mode === 'custom' && (
        <>
          <input 
            type="date" 
            className="rounded-md border border-border bg-surface px-3 py-1.5 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            value={customRange.from}
            onChange={e => handleCustomChange('from', e.target.value)}
          />
          <span className="text-text-muted text-sm">to</span>
          <input 
            type="date" 
            className="rounded-md border border-border bg-surface px-3 py-1.5 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            value={customRange.to}
            onChange={e => handleCustomChange('to', e.target.value)}
          />
        </>
      )}
    </div>
  );
}
