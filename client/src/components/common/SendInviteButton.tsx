import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, Mail, Check } from 'lucide-react';
import { Button } from '../ui/Button.js';
import * as adminApi from '../../services/adminApi.js';

interface Props {
  onSend: (selectedChannels: string[]) => void;
  loading?: boolean;
  disabled?: boolean;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
  variant?: 'primary' | 'outline' | 'ghost';
  title?: string;
  placement?: 'top' | 'bottom';
}

const STORAGE_KEY = 'agnohire_invite_channels';

export function SendInviteButton({
  onSend,
  loading = false,
  disabled = false,
  className = '',
  size = 'sm',
  variant = 'primary',
  title,
  placement = 'bottom',
}: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Fetch tenant integrations
  const { data: integrations } = useQuery({
    queryKey: ['admin-integrations'],
    queryFn: adminApi.fetchIntegrations,
  });

  // Verify if WhatsApp is connected/enabled for candidate invitation delivery
  const isWhatsAppActive = useMemo(() => {
    if (!integrations) return false;
    return integrations.some((i) => i.type === 'whatsapp' && i.isEnabled);
  }, [integrations]);

  // Load selection memory from sessionStorage
  const [selected, setSelected] = useState<string[]>(() => {
    try {
      const stored = sessionStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.includes('email')) {
          return parsed;
        }
      }
    } catch {
      // Fallback
    }
    return ['email'];
  });

  // Keep sessionStorage in sync
  const updateSelection = (channels: string[]) => {
    setSelected(channels);
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(channels));
    } catch {
      // Ignore
    }
  };

  // Close dropdown on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Clicking Send Invite
  const handleMainActionClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!isWhatsAppActive) {
      // If WhatsApp is NOT active, immediately trigger Email invitation
      onSend(['email']);
    } else {
      // Toggle dropdown open
      setIsOpen(!isOpen);
    }
  };

  const handleSendClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsOpen(false);
    onSend(selected);
  };

  const toggleChannel = (channel: string) => {
    if (channel === 'email') return; // Email cannot be unchecked
    const nextSelected = selected.includes(channel)
      ? selected.filter((c) => c !== channel)
      : [...selected, channel];
    updateSelection(nextSelected);
  };

  return (
    <div className="relative inline-block text-left" ref={dropdownRef}>
      <Button
        type="button"
        variant={variant}
        size={size}
        disabled={disabled}
        loading={loading}
        onClick={handleMainActionClick}
        title={title}
        className={`flex items-center gap-1.5 ${className}`}
      >
        <Mail className="h-4 w-4" />
        <span>Send invite</span>
        {isWhatsAppActive && <ChevronDown className="h-3.5 w-3.5 opacity-80" />}
      </Button>

      {isWhatsAppActive && isOpen && (
        <div
          className={
            placement === 'top'
              ? 'absolute right-0 bottom-full mb-1.5 w-56 origin-bottom-right rounded-lg border border-border bg-surface shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none z-50 p-2.5 space-y-3'
              : 'absolute right-0 top-full mt-1.5 w-56 origin-top-right rounded-lg border border-border bg-surface shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none z-50 p-2.5 space-y-3'
          }
        >
          <div className="text-xs font-semibold text-text-muted px-1.5 pt-1 uppercase tracking-wider">
            Select Channels
          </div>
          <div className="space-y-1.5">
            {/* Email */}
            <label className="flex items-center gap-2.5 p-1.5 rounded hover:bg-hover cursor-not-allowed opacity-80">
              <input
                type="checkbox"
                checked={true}
                disabled={true}
                className="h-4 w-4 rounded border-border text-accent focus:ring-accent cursor-not-allowed"
              />
              <span className="text-sm font-medium text-text-primary">Email</span>
            </label>

            {/* WhatsApp */}
            <label
              onClick={() => toggleChannel('whatsapp')}
              className="flex items-center justify-between gap-2.5 p-1.5 rounded hover:bg-hover cursor-pointer transition-colors"
            >
              <div className="flex items-center gap-2.5">
                <input
                  type="checkbox"
                  checked={selected.includes('whatsapp')}
                  readOnly
                  className="h-4 w-4 rounded border-border text-accent focus:ring-accent cursor-pointer"
                />
                <span className="text-sm font-medium text-text-primary">WhatsApp</span>
              </div>
              {selected.includes('whatsapp') && <Check className="h-3.5 w-3.5 text-accent" />}
            </label>
          </div>

          <div className="border-t border-border/60 pt-2.5 flex justify-end">
            <Button
              type="button"
              size="sm"
              variant="primary"
              onClick={handleSendClick}
              disabled={disabled || loading}
              className="w-full text-center py-1.5 font-medium"
            >
              Send Now
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
