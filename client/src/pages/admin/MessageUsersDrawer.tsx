import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Send } from 'lucide-react';
import { Drawer } from '../../components/ui/Drawer.js';
import { Button } from '../../components/ui/Button.js';
import { Input } from '../../components/ui/Input.js';
import { Textarea } from '../../components/ui/Textarea.js';
import * as adminApi from '../../services/adminApi.js';
import { apiErrorMessage } from '../../services/api.js';
import type { AdminUserItem } from '@agnohire/shared';

interface Props {
  open: boolean;
  onClose: () => void;
  users: AdminUserItem[];
  initialIds?: string[];
}

export function MessageUsersDrawer({ open, onClose, users, initialIds = [] }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set(initialIds));
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');

  const reset = () => {
    setSelected(new Set(initialIds));
    setSubject('');
    setMessage('');
  };

  const send = useMutation({
    mutationFn: () =>
      adminApi.sendUserMessage({ recipientIds: [...selected], subject: subject.trim(), message: message.trim() }),
    onSuccess: (r) => {
      if (r.sent > 0) toast.success(`Sent to ${r.sent} of ${r.total} recipient${r.total === 1 ? '' : 's'}`);
      else if (r.skipped > 0)
        toast('Saved, but not delivered — SMTP isn’t set up yet (System Config → Email).', { icon: '✉️' });
      else toast.error('Could not deliver the message');
      reset();
      onClose();
    },
    onError: (e) => toast.error(apiErrorMessage(e, 'Could not send message')),
  });

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const allSelected = users.length > 0 && selected.size === users.length;
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(users.map((u) => u.id)));

  const canSend = selected.size > 0 && subject.trim() && message.trim();

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Message users"
      subtitle="Send an email to selected team members"
      footer={
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-text-muted">{selected.size} selected</span>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button loading={send.isPending} disabled={!canSend} onClick={() => send.mutate()}>
              <Send className="h-4 w-4" /> Send
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className="text-xs font-medium text-text-secondary">Recipients</span>
            <button type="button" onClick={toggleAll} className="text-xs text-accent hover:underline">
              {allSelected ? 'Clear all' : 'Select all'}
            </button>
          </div>
          <div className="max-h-52 space-y-1 overflow-y-auto rounded-lg border border-border bg-surface p-1.5">
            {users.map((u) => (
              <label key={u.id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-surface-raised">
                <input type="checkbox" checked={selected.has(u.id)} onChange={() => toggle(u.id)} className="accent-accent" />
                <span className="min-w-0 flex-1">
                  <span className="text-sm text-text-primary">{u.fullName}</span>
                  <span className="ml-2 text-xs text-text-muted">{u.email}</span>
                </span>
              </label>
            ))}
          </div>
        </div>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-text-secondary">Subject</span>
          <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject line" />
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-text-secondary">Message</span>
          <Textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Write your message…"
            className="min-h-[160px]"
          />
        </label>
      </div>
    </Drawer>
  );
}
