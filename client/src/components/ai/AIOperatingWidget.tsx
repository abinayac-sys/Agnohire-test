import { useEffect, useState, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getSocket } from '../../services/socket.js';
import * as aiApi from '../../services/aiApi.js';
import { api, apiErrorMessage } from '../../services/api.js';
import { useAuthStore } from '../../store/authStore.js';
import { 
  Sparkles, X, Plus, 
  Send, Bot, FileText 
} from 'lucide-react';
import { toast } from 'react-hot-toast';

/**
 * Converts LLM markdown output into clean readable HTML.
 * Strips heading symbols, bold/italic markers, raw JSON blocks,
 * and converts lists/line-breaks into proper elements.
 */
function renderMarkdown(text: string): React.ReactNode {
  if (!text || !text.trim()) {
    return <span className="text-text-muted italic">Action completed.</span>;
  }

  // Only strip JSON found INSIDE fenced code blocks the LLM may accidentally
  // include — never bare {..}/[..] in regular prose, which would otherwise
  // also nuke legitimate text like a salary range "[50k-70k]", a numbered
  // reference "[1]", or a markdown link, sometimes blanking the whole reply.
  let cleanText = text
    .replace(/```json\s*[\s\S]*?```/gi, '')
    .replace(/```\s*[\s\S]*?```/g, (match) => {
      const inner = match.replace(/^```[a-z]*\s*/i, '').replace(/\s*```$/, '').trim();
      return inner.startsWith('{') || inner.startsWith('[') ? '' : inner;
    })
    .replace(/`([^`]+)`/g, '$1')             // remove inline code ticks
    .replace(/^#{1,6}\s*/gm, '')            // remove # heading markers
    .trim();

  // If stripping fenced blocks happened to empty the text (e.g. the whole
  // reply was one JSON code block), fall back to the untouched original
  // rather than rendering a blank bubble.
  if (!cleanText) {
    cleanText = text.trim();
  }

  // Split into lines and process each
  const lines = cleanText.split('\n');
  const elements: React.ReactNode[] = [];
  let key = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) { elements.push(<br key={key++} />); continue; }

    // List items: lines starting with - or *
    if (/^[-*]\s+/.test(trimmed)) {
      const content = trimmed.replace(/^[-*]\s+/, '');
      elements.push(
        <div key={key++} className="flex gap-1.5 items-start">
          <span className="mt-0.5 shrink-0 text-accent">•</span>
          <span>{inlineMarkdown(content)}</span>
        </div>
      );
      continue;
    }

    elements.push(<p key={key++} className="leading-relaxed">{inlineMarkdown(trimmed)}</p>);
  }

  return <div className="space-y-0.5">{elements}</div>;
}

/** Converts inline **bold** and *italic* within a string to React nodes. */
function inlineMarkdown(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('*') && part.endsWith('*')) {
      return <em key={i}>{part.slice(1, -1)}</em>;
    }
    return part;
  });
}

/**
 * Maps AI tool name prefixes → React Query cache keys to invalidate.
 * When the AI executes a tool, all matching query keys are invalidated
 * so the relevant pages refresh automatically with fresh data.
 */
const TOOL_QUERY_MAP: Record<string, string[][]> = {
  // Sectors & Domains
  createSector:          [['admin-sectors'], ['sectors']],
  updateSector:          [['admin-sectors'], ['sectors']],
  deleteSector:          [['admin-sectors'], ['sectors']],
  createDomain:          [['admin-sectors'], ['sectors'], ['domains']],
  updateDomain:          [['admin-sectors'], ['sectors'], ['domains']],
  deleteDomain:          [['admin-sectors'], ['sectors'], ['domains']],
  // Jobs
  createJob:             [['jobs'], ['jobs-stats']],
  updateJob:             [['jobs'], ['jobs-stats']],
  closeJob:              [['jobs'], ['jobs-stats']],
  deleteJob:             [['jobs'], ['jobs-stats']],
  publishJob:            [['jobs'], ['jobs-stats']],
  archiveJob:            [['jobs'], ['jobs-stats']],
  // Candidates
  createCandidate:                     [['candidates'], ['candidate-stats'], ['candidate-lists']],
  updateCandidate:                     [['candidates'], ['candidate-stats']],
  deleteCandidate:                     [['candidates'], ['candidate-stats']],
  uploadCandidateList:                 [['candidates'], ['candidate-stats'], ['candidate-lists']],
  importCandidateListFromAttachment:   [['candidates'], ['candidate-stats'], ['candidate-lists']],
  // Applications
  createApplication:     [['applications'], ['pipeline']],
  updateApplication:     [['applications'], ['pipeline']],
  rejectApplication:     [['applications'], ['pipeline']],
  withdrawApplication:   [['applications'], ['pipeline']],
  // Interviews
  createInterview:       [['interviews'], ['schedules']],
  updateInterview:       [['interviews'], ['schedules']],
  deleteInterview:       [['interviews'], ['schedules']],
  scheduleInterview:     [['interviews'], ['schedules']],
  // Offers
  createOffer:           [['offers']],
  updateOffer:           [['offers']],
  sendOffer:             [['offers']],
  withdrawOffer:         [['offers']],
  // Reviews
  createReview:          [['reviews']],
  updateReview:          [['reviews']],
  submitReview:          [['reviews']],
  // Pipeline
  movePipelineCard:      [['pipeline']],
  updatePipelineCard:    [['pipeline']],
  // Users / Admin
  createUser:            [['admin-users']],
  updateUser:            [['admin-users']],
  deleteUser:            [['admin-users']],
  disableUser:           [['admin-users']],
  // System config
  updateSystemConfig:    [['system-config']],
  // Question banks & Assessments
  createQuestionBank:    [['question-banks']],
  importQuestionBankFromAttachment: [['question-banks']],
  updateQuestionBank:    [['question-banks']],
  deleteQuestionBank:    [['question-banks']],
  generateTestLink:      [['assessments'], ['schedules'], ['candidates'], ['pipeline']],
  // HR Approvals
  approveHRRequest:      [['hr-queue'], ['hr-processed']],
  rejectHRRequest:       [['hr-queue'], ['hr-processed']],
  // Notifications
  sendNotification:      [['notifications', 'list'], ['notifications', 'unread-count']],
};

interface Message {
  role: 'user' | 'assistant';
  content: string;
  files?: Array<{ id: string; name: string; type: string }>;
}

interface PendingConfirmation {
  toolName: string;
  preview: unknown;
  confirmationToken: string;
}

interface ProgressStep {
  status: 'running' | 'success' | 'failed';
  tool: string;
  message: string;
}

function chatHistoryKey(scope: string): string {
  return `agnohire.ai.chat_history.${scope}`;
}
function workflowStateKey(scope: string): string {
  return `agnohire.ai.workflow_state.${scope}`;
}
function loadJson<T>(key: string, fallback: T): T {
  try {
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) : fallback;
  } catch {
    return fallback;
  }
}

export function AIOperatingWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [instruction, setInstruction] = useState('');
  const [loading, setLoading] = useState(false);
  const tenantScope = useAuthStore((s) => s.user?.tenantSlug ?? s.user?.id ?? 'anonymous');
  const [messages, setMessages] = useState<Message[]>(() => loadJson(chatHistoryKey(tenantScope), []));
  const [workflowState, setWorkflowState] = useState<any>(() => loadJson(workflowStateKey(tenantScope), null));
  const [progressSteps, setProgressSteps] = useState<ProgressStep[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [pendingConfirmation, setPendingConfirmation] = useState<PendingConfirmation | null>(null);

  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadType, setUploadType] = useState<'photo' | 'doc' | 'bulk' | null>(null);
  const [stagedFile, setStagedFile] = useState<{
    file: File;
    uploadType: 'photo' | 'doc' | 'bulk';
  } | null>(null);

  // A user can switch tenants (or log out/in as a different tenant) without
  // a full page reload — when that happens, swap in that tenant's own
  // history instead of leaving the previous tenant's conversation on screen.
  const prevScopeRef = useRef(tenantScope);
  useEffect(() => {
    if (prevScopeRef.current === tenantScope) return;
    prevScopeRef.current = tenantScope;
    setMessages(loadJson(chatHistoryKey(tenantScope), []));
    setWorkflowState(loadJson(workflowStateKey(tenantScope), null));
    setProgressSteps([]);
  }, [tenantScope]);

  // One-time cleanup of the old, unscoped keys from before per-tenant
  // isolation existed — leaving them around serves no purpose and they'd
  // otherwise sit in the browser forever.
  useEffect(() => {
    localStorage.removeItem('agnohire.ai.chat_history');
    localStorage.removeItem('agnohire.ai.workflow_state');
  }, []);

  // Sync state to localStorage, scoped to the active tenant
  useEffect(() => {
    localStorage.setItem(chatHistoryKey(tenantScope), JSON.stringify(messages));
  }, [messages, tenantScope]);

  useEffect(() => {
    if (workflowState) {
      localStorage.setItem(workflowStateKey(tenantScope), JSON.stringify(workflowState));
    } else {
      localStorage.removeItem(workflowStateKey(tenantScope));
    }
  }, [workflowState, tenantScope]);

  // Dragging State & Coordinates
  const [buttonPos, setButtonPos] = useState({ x: window.innerWidth - 72, y: window.innerHeight - 72 });
  const [cardPos, setCardPos] = useState({ x: window.innerWidth - 404, y: window.innerHeight - 574 });
  const dragStartRef = useRef<{ x: number; y: number; moved: boolean } | null>(null);

  // Sync positions when window dimensions change
  useEffect(() => {
    const handleResize = () => {
      setButtonPos((prev) => ({
        x: Math.min(window.innerWidth - 72, prev.x),
        y: Math.min(window.innerHeight - 72, prev.y)
      }));
      setCardPos((prev) => ({
        x: Math.min(window.innerWidth - 404, prev.x),
        y: Math.min(window.innerHeight - 574, prev.y)
      }));
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Keyboard shortcut Ctrl+K or Cmd+K
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setIsOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Socket setup
  useEffect(() => {
    if (!isOpen) return;
    const socket = getSocket();
    
    const handleProgress = (data: any) => {
      setProgressSteps((prev) => [
        ...prev.filter((p) => p.tool !== data.tool || data.status === 'running'),
        {
          status: data.status,
          tool: data.tool,
          message: data.message,
        },
      ]);
      if (data.workflowState) {
        setWorkflowState(data.workflowState);
      }
    };

    socket.on('ai:step_progress', handleProgress);
    return () => {
      socket.off('ai:step_progress', handleProgress);
    };
  }, [isOpen]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, progressSteps, loading]);

  const qc = useQueryClient();

  const handleConfirmation = async (confirmed: boolean) => {
    const pending = pendingConfirmation;
    if (!pending) return;
    setPendingConfirmation(null);
    if (!confirmed) {
      setMessages((prev) => [...prev, { role: 'assistant', content: `Cancelled — ${pending.toolName} was not run.` }]);
      return;
    }
    setLoading(true);
    try {
      const history = messages.map((m) => ({ role: m.role, content: m.content }));
      const res = await aiApi.runAICommand('(confirmed)', workflowState, history, pending.confirmationToken);
      const assistantContent = (res.output && res.output.trim()) ? res.output.trim() : '✓ Action completed successfully.';
      setMessages((prev) => [...prev, { role: 'assistant', content: assistantContent }]);
      setWorkflowState(res.workflowState);
      setPendingConfirmation(res.pendingConfirmation ?? null);
      toast.success('AI action complete');
    } catch (err) {
      const msg = apiErrorMessage(err, 'AI action failed');
      toast.error(msg);
      setMessages((prev) => [...prev, { role: 'assistant', content: `Error: ${msg}` }]);
    } finally {
      setLoading(false);
    }
  };

  const handleExecute = async (e: React.FormEvent, directText?: string) => {
    if (e) e.preventDefault();
    let textToSend = directText || instruction;
    const currentStagedFile = stagedFile;

    if (!textToSend.trim() && !currentStagedFile) return;

    // Starting a new instruction implicitly abandons any pending
    // confirmation card — the token itself expires unused after 5 minutes.
    setPendingConfirmation(null);
    setLoading(true);
    setProgressSteps([]);

    let attachmentId: string | null = null;
    if (currentStagedFile) {
      const formData = new FormData();
      formData.append('file', currentStagedFile.file);
      const loadToast = toast.loading(`Uploading ${currentStagedFile.file.name}...`);
      try {
        const res = await api.post('/files', formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
        attachmentId = res.data?.data?.attachment?.id;
        toast.success('File uploaded successfully', { id: loadToast });
      } catch (err: any) {
        toast.error(apiErrorMessage(err, 'Failed to upload file'), { id: loadToast });
        setLoading(false);
        return;
      }
    }

    if (currentStagedFile && attachmentId) {
      if (textToSend.trim()) {
        textToSend = `${textToSend.trim()} (Attached File: ${currentStagedFile.file.name}, Document ID: ${attachmentId})`;
      } else if (currentStagedFile.uploadType === 'bulk') {
        textToSend = `Bulk import candidates from document ID ${attachmentId} (Filename: ${currentStagedFile.file.name})`;
      } else {
        textToSend = `Analyze and process the uploaded document "${currentStagedFile.file.name}" (ID: ${attachmentId})`;
      }
    }

    const displayUserContent = directText || instruction.trim() || (currentStagedFile ? `Attached: ${currentStagedFile.file.name}` : '');
    const userMsg: Message = { role: 'user', content: displayUserContent };
    setMessages((prev) => [...prev, userMsg]);
    setInstruction('');
    setStagedFile(null);

    try {
      const history = messages.map(m => ({ role: m.role, content: m.content }));
      const res = await aiApi.runAICommand(textToSend, workflowState, history);
      
      // A tool-only turn (no narrative reply) leaves res.output empty —
      // show a confirmation message instead of a blank chat bubble.
      const assistantContent = (res.output && res.output.trim()) ? res.output.trim() : '✓ Action completed successfully.';
      setMessages((prev) => [...prev, { role: 'assistant', content: assistantContent }]);
      setWorkflowState(res.workflowState);
      setPendingConfirmation(res.pendingConfirmation ?? null);

      // Invalidate React Query caches for every tool the AI executed
      const keysInvalidated = new Set<string>();
      for (const action of res.actionsRun ?? []) {
        if (!action.success) continue;
        const queryKeys = TOOL_QUERY_MAP[action.tool];
        if (queryKeys) {
          for (const qk of queryKeys) {
            const key = qk.join(':');
            if (!keysInvalidated.has(key)) {
              keysInvalidated.add(key);
              qc.invalidateQueries({ queryKey: qk });
            }
          }
        }
      }

      toast.success('AI action complete');
    } catch (err: any) {
      toast.error(apiErrorMessage(err, 'AI action failed'));
      setMessages((prev) => [...prev, { role: 'assistant', content: `Error: ${apiErrorMessage(err, 'Execution failed.')}` }]);
    } finally {
      setLoading(false);
    }
  };

  const handleResetChat = async () => {
    if (messages.length > 0) {
      try {
        await aiApi.saveHistory(messages);
      } catch (err) {
        console.error('Failed to save AI history', err);
      }
    }
    setMessages([]);
    setWorkflowState(null);
    setProgressSteps([]);
    setInstruction('');
    setStagedFile(null);
    setPendingConfirmation(null);
    localStorage.removeItem(chatHistoryKey(tenantScope));
    localStorage.removeItem(workflowStateKey(tenantScope));
    toast.success('Conversation reset');
  };

  const triggerUpload = (type: 'photo' | 'doc' | 'bulk') => {
    setUploadType(type);
    setMenuOpen(false);
    fileInputRef.current?.click();
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setStagedFile({
      file,
      uploadType: uploadType || 'doc',
    });
    setUploadType(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // Mouse Drag Handler
  const handleDragStart = (e: React.MouseEvent, type: 'button' | 'card') => {
    e.preventDefault();
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      moved: false
    };

    const initialPos = type === 'button' ? buttonPos : cardPos;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!dragStartRef.current) return;
      const deltaX = moveEvent.clientX - dragStartRef.current.x;
      const deltaY = moveEvent.clientY - dragStartRef.current.y;

      if (Math.abs(deltaX) > 4 || Math.abs(deltaY) > 4) {
        dragStartRef.current.moved = true;
      }

      const newX = Math.max(10, Math.min(window.innerWidth - (type === 'button' ? 60 : 390), initialPos.x + deltaX));
      const newY = Math.max(10, Math.min(window.innerHeight - (type === 'button' ? 60 : 560), initialPos.y + deltaY));

      if (type === 'button') {
        setButtonPos({ x: newX, y: newY });
      } else {
        setCardPos({ x: newX, y: newY });
      }
    };

    const handleMouseUp = () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  const handleButtonClick = () => {
    // If we dragged the button, don't open the widget on release
    if (dragStartRef.current?.moved) return;
    setIsOpen(true);
  };

  if (!isOpen) {
    return (
      <button
        type="button"
        onMouseDown={(e) => handleDragStart(e, 'button')}
        onClick={handleButtonClick}
        style={{ left: buttonPos.x, top: buttonPos.y }}
        className="fixed z-40 flex items-center justify-center h-12 w-12 rounded-full bg-accent text-accent-fg shadow-xl cursor-move hover:scale-105 active:scale-95 transition-transform duration-200"
        title="Drag me! Click to open (Ctrl+K)"
      >
        <Sparkles className="h-5 w-5 animate-pulse pointer-events-none" />
      </button>
    );
  }

  return (
    <div 
      style={{ left: cardPos.x, top: cardPos.y }}
      className="fixed z-50 w-[380px] h-[550px] bg-surface border border-border shadow-2xl rounded-[24px] overflow-hidden flex flex-col transition-all duration-200"
    >
      <input 
        type="file" 
        ref={fileInputRef} 
        onChange={handleFileSelect} 
        className="hidden" 
        accept={uploadType === 'photo' ? 'image/*' : '*'} 
      />

      {/* Blue Header - Click and Drag handle */}
      <div 
        onMouseDown={(e) => handleDragStart(e, 'card')}
        className="flex items-center justify-between bg-accent px-5 py-4 text-accent-fg cursor-move select-none"
      >
        <div className="flex items-center gap-2 pointer-events-none">
          <Bot className="h-5 w-5 fill-current text-accent-fg/90" />
          <span className="font-semibold text-base leading-none">Agno Support</span>
        </div>
        <div className="flex items-center gap-3">
          <button 
            type="button" 
            onClick={handleResetChat}
            className="hover:bg-white/20 p-1 rounded-md transition-colors"
            title="Reset Chat"
          >
            <Plus className="h-4.5 w-4.5" />
          </button>
          <button 
            type="button" 
            onClick={() => setIsOpen(false)}
            className="hover:bg-white/20 p-1 rounded-md transition-colors"
            title="Close"
          >
            <X className="h-4.5 w-4.5" />
          </button>
        </div>
      </div>

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-surface">
        {messages.length === 0 && !loading && (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="bg-accent-muted p-4 rounded-full mb-3 text-accent">
              <Sparkles className="h-7 w-7" />
            </div>
            <p className="text-text-primary font-medium text-base">Ask me anything!</p>
          </div>
        )}

        {messages.map((msg, idx) => (
          <div
            key={idx}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[85%] rounded-[18px] px-4 py-2.5 text-sm leading-relaxed ${
                msg.role === 'user'
                  ? 'bg-accent text-accent-fg rounded-tr-none'
                  : 'bg-surface-raised border border-border-subtle text-text-primary rounded-tl-none'
              }`}
            >
              {msg.role === 'assistant' ? renderMarkdown(msg.content) : msg.content}
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex justify-start">
            <div className="bg-surface-raised border border-border-subtle rounded-[18px] rounded-tl-none px-4 py-3 flex items-center gap-1.5">
              <span className="flex gap-1 items-center">
                <span className="h-1.5 w-1.5 rounded-full bg-accent animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="h-1.5 w-1.5 rounded-full bg-accent animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="h-1.5 w-1.5 rounded-full bg-accent animate-bounce" style={{ animationDelay: '300ms' }} />
              </span>
            </div>
          </div>
        )}
        
        <div ref={bottomRef} />
      </div>

      {pendingConfirmation && (
        <div className="px-3 pt-2 pb-1 bg-surface border-t border-danger/40 animate-in fade-in slide-in-from-bottom-1">
          <div className="rounded-xl border border-danger/40 bg-danger/10 px-3 py-2.5">
            <p className="text-xs font-medium text-text-primary">
              {typeof pendingConfirmation.preview === 'string'
                ? pendingConfirmation.preview
                : `About to run ${pendingConfirmation.toolName}. Confirm to proceed.`}
            </p>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                disabled={loading}
                onClick={() => handleConfirmation(true)}
                className="flex-1 rounded-full bg-danger px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 active:scale-95 disabled:opacity-50 transition-all"
              >
                Confirm
              </button>
              <button
                type="button"
                disabled={loading}
                onClick={() => handleConfirmation(false)}
                className="flex-1 rounded-full border border-border px-3 py-1.5 text-xs font-semibold text-text-secondary hover:bg-surface-raised active:scale-95 disabled:opacity-50 transition-all"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Popover Menu */}
      {menuOpen && (
        <div className="absolute bottom-[72px] left-6 z-50 bg-surface-overlay border border-border shadow-xl rounded-[20px] p-2 w-[240px] flex flex-col gap-1 transition-all duration-150 animate-in fade-in slide-in-from-bottom-2">

          <button
            type="button"
            onClick={() => triggerUpload('doc')}
            className="flex items-center gap-3 px-3 py-2 text-sm text-text-primary hover:bg-accent-muted hover:text-accent rounded-xl text-left transition-colors"
          >
            <FileText className="h-4.5 w-4.5" />
            <span>Documents</span>
          </button>
          <button
            type="button"
            onClick={() => triggerUpload('bulk')}
            className="flex items-center gap-3 px-3 py-2 text-sm text-text-primary hover:bg-accent-muted hover:text-accent rounded-xl text-left transition-colors"
          >
            <Bot className="h-4.5 w-4.5" />
            <span>Bulk Import Candidates</span>
          </button>
        </div>
      )}

      {/* Staged File Preview Chip */}
      {stagedFile && (
        <div className="px-3 pt-2 pb-1 bg-surface border-t border-border/40 flex items-center justify-between animate-in fade-in slide-in-from-bottom-1">
          <div className="flex items-center gap-2 bg-accent-muted border border-accent/30 rounded-xl px-3 py-1.5 text-xs text-accent max-w-[85%]">
            <FileText className="h-4 w-4 shrink-0" />
            <span className="font-medium truncate max-w-[180px]">{stagedFile.file.name}</span>
            <span className="text-[10px] bg-surface px-1.5 py-0.5 rounded text-accent font-semibold uppercase tracking-wider shrink-0 border border-accent/30">
              {stagedFile.uploadType === 'bulk' ? 'Bulk Import' : stagedFile.uploadType === 'photo' ? 'Media' : 'Document'}
            </span>
          </div>
          <button
            type="button"
            onClick={() => setStagedFile(null)}
            className="p-1 rounded-full text-text-secondary hover:bg-black/5 hover:text-danger transition-colors"
            title="Remove file"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Hidden File Input */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileSelect}
        className="hidden"
        accept={uploadType === 'photo' ? 'image/*,video/*' : '*'}
      />

      {/* Bottom Input Bar */}
      <div className="p-3 bg-surface border-t border-border/60 flex items-center gap-2">
        <button
          type="button"
          onClick={() => setMenuOpen(!menuOpen)}
          className={`flex items-center justify-center h-10 w-10 rounded-full border border-border bg-surface shadow-sm hover:bg-surface-raised active:scale-95 transition-all duration-150 shrink-0 ${
            menuOpen ? 'text-danger rotate-45' : 'text-text-secondary'
          }`}
        >
          {menuOpen ? <X className="h-5 w-5" /> : <Plus className="h-5 w-5" />}
        </button>

        <form onSubmit={handleExecute} className="flex-1 flex items-center gap-2 relative">
          <input
            type="text"
            placeholder={stagedFile ? "Add an optional instruction (e.g. create question bank)..." : "Type a message..."}
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            disabled={loading}
            className="w-full bg-bg text-text-primary text-sm rounded-full px-4 py-2.5 outline-none border border-transparent focus:border-border transition-all"
          />
          <button
            type="submit"
            disabled={loading || (!instruction.trim() && !stagedFile)}
            className="flex items-center justify-center h-10 w-10 rounded-full bg-accent text-accent-fg hover:bg-accent-hover active:scale-95 disabled:opacity-50 disabled:scale-100 transition-all shrink-0 shadow-md"
          >
            {loading ? (
              <span className="flex gap-[3px] items-center">
                <span className="h-1.5 w-1.5 rounded-full bg-accent-fg animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="h-1.5 w-1.5 rounded-full bg-accent-fg animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="h-1.5 w-1.5 rounded-full bg-accent-fg animate-bounce" style={{ animationDelay: '300ms' }} />
              </span>
            ) : (
              <Send className="h-4.5 w-4.5 rotate-45 -translate-x-[1px]" />
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
