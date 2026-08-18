import { useState, useRef, useEffect } from 'react';
import { Send, X, Sparkles, Loader2 } from 'lucide-react';
import { Button } from '../../components/ui/Button.js';
import * as jobApi from '../../services/jobApi.js';
import { useMutation } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { apiErrorMessage } from '../../services/api.js';

interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

interface JobCopilotProps {
  onClose: () => void;
  currentContext: any;
  onUpdateForm: (updates: any) => void;
}

export function JobCopilot({ onClose, currentContext, onUpdateForm }: JobCopilotProps) {
  const [messages, setMessages] = useState<Message[]>([
    { role: 'assistant', content: 'Hi! I am your AI Recruitment Copilot. What kind of job requisition would you like to create today?' }
  ]);
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const copilotMutation = useMutation({
    mutationFn: (data: { context: any, messages: Message[] }) => jobApi.chatWithCopilot(data),
    onSuccess: (res) => {
      if (res.updatedForm) {
        onUpdateForm(res.updatedForm);
      }
      if (res.generatedContent) {
        onUpdateForm({ description: res.generatedContent });
      }

      let content = '';
      if (res.missingFields && res.missingFields.length > 0) {
        content = `I need a bit more info: ${res.missingFields.join(', ')}.`;
      } else if (res.generatedContent) {
        content = 'I have generated the complete job description based on your requirements!';
      } else if (res.intent === 'MODIFY') {
        content = 'I have updated the form with your changes.';
      } else {
        content = 'Got it. What else?';
      }

      setMessages((prev) => [...prev, { role: 'assistant', content }]);
    },
    onError: (err: any) => {
      toast.error(apiErrorMessage(err, 'Copilot error'));
      setMessages((prev) => [...prev, { role: 'assistant', content: 'Sorry, I encountered an error. Please try again.' }]);
    }
  });

  const handleSend = (text: string) => {
    if (!text.trim() || copilotMutation.isPending) return;
    
    const newMessages: Message[] = [...messages, { role: 'user', content: text }];
    setMessages(newMessages);
    setInput('');
    
    copilotMutation.mutate({
      context: currentContext,
      messages: newMessages.filter(m => m.role !== 'system')
    });
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, copilotMutation.isPending]);

  return (
    <div className="flex flex-col h-full bg-surface-raised w-80 shadow-2xl overflow-hidden rounded-l-lg absolute top-0 right-0 z-50 animate-in slide-in-from-right duration-300">
      <div className="flex items-center justify-between p-4 border-b border-border bg-surface">
        <div className="flex items-center gap-2 text-primary">
          <Sparkles className="w-5 h-5" />
          <h3 className="font-medium">AI Copilot</h3>
        </div>
        <button onClick={onClose} className="p-1 hover:bg-surface-hover rounded text-text-muted">
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-surface">
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] rounded-lg p-3 text-sm ${m.role === 'user' ? 'bg-primary text-white' : 'bg-surface-raised border border-border text-text-primary'}`}>
              {m.content}
            </div>
          </div>
        ))}
        {copilotMutation.isPending && (
          <div className="flex justify-start">
            <div className="bg-surface-raised border border-border rounded-lg p-3 text-sm flex items-center gap-2 text-text-muted">
              <Loader2 className="w-4 h-4 animate-spin" />
              Thinking...
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="p-4 border-t border-border bg-surface">
        <div className="flex gap-2">
          <input
            type="text"
            className="flex-1 rounded-md border border-border bg-surface-raised px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            placeholder="Type a command..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSend(input); }}
          />
          <Button onClick={() => handleSend(input)} disabled={!input.trim() || copilotMutation.isPending} size="sm">
            <Send className="w-4 h-4" />
          </Button>
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          <span onClick={() => handleSend('Create a Backend Developer job')} className="text-[10px] bg-surface-hover border border-border rounded px-2 py-1 cursor-pointer text-text-muted hover:text-primary transition-colors">Create Backend Dev</span>
          <span onClick={() => handleSend('Make it Remote')} className="text-[10px] bg-surface-hover border border-border rounded px-2 py-1 cursor-pointer text-text-muted hover:text-primary transition-colors">Make Remote</span>
        </div>
      </div>
    </div>
  );
}
