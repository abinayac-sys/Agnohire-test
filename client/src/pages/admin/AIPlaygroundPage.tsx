import { useEffect, useState, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getSocket } from '../../services/socket.js';
import * as aiApi from '../../services/aiApi.js';
import { PageHeader } from '../../components/common/PageHeader.js';
import { Button } from '../../components/ui/Button.js';
import { Badge } from '../../components/ui/Badge.js';
import { Play, Sparkles, Terminal, CheckCircle2, XCircle, Loader2, Eye, Trash2, Download, MessageSquare } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { format } from 'date-fns';
import { apiErrorMessage } from '../../services/api.js';

interface ProgressStep {
  status: 'running' | 'success' | 'failed';
  tool: string;
  message: string;
}

export function AIPlaygroundPage() {
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState<'console' | 'history'>('console');
  
  const [instruction, setInstruction] = useState('');
  const [loading, setLoading] = useState(false);
  const [output, setOutput] = useState<string | null>(null);
  const [workflowState, setWorkflowState] = useState<any>(null);
  const [actionsRun, setActionsRun] = useState<any[]>([]);
  const [progressSteps, setProgressSteps] = useState<ProgressStep[]>([]);
  const [currentChatHistory, setCurrentChatHistory] = useState<Array<{role: 'user' | 'assistant', content: string}>>([]);

  const [viewHistoryData, setViewHistoryData] = useState<aiApi.AiChatHistoryDto | null>(null);

  const bottomRef = useRef<HTMLDivElement>(null);

  const { data: histories, isLoading: historyLoading } = useQuery({
    queryKey: ['ai-histories'],
    queryFn: aiApi.getHistories,
    enabled: activeTab === 'history',
  });

  useEffect(() => {
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
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [progressSteps, output]);

  const handleExecute = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!instruction.trim()) return;

    setLoading(true);
    setOutput(null);
    setProgressSteps([]);
    setActionsRun([]);

    try {
      const res = await aiApi.runAICommand(instruction, workflowState, currentChatHistory);
      setCurrentChatHistory(prev => [
        ...prev,
        { role: 'user', content: instruction },
        { role: 'assistant', content: res.output }
      ]);
      setOutput(res.output);
      setWorkflowState(res.workflowState);
      setActionsRun(res.actionsRun);
      toast.success('AI execution complete');
    } catch (err: any) {
      toast.error(apiErrorMessage(err, 'AI execution failed'));
    } finally {
      setLoading(false);
    }
  };

  const handleResetWorkflow = async () => {
    // Save the console session to History before clearing it — otherwise
    // nothing run in the Execution Console ever shows up in the History tab
    // at all (only the separate floating AI widget saved on its own reset).
    if (currentChatHistory.length > 0) {
      try {
        await aiApi.saveHistory(currentChatHistory);
        qc.invalidateQueries({ queryKey: ['ai-histories'] });
      } catch (err) {
        console.error('Failed to save AI history', err);
      }
    }
    setWorkflowState(null);
    setProgressSteps([]);
    setActionsRun([]);
    setCurrentChatHistory([]);
    setOutput(null);
    toast.success('Workflow state reset');
  };

  const handleDeleteHistory = async (id: string) => {
    if (!window.confirm('Are you sure you want to delete this history?')) return;
    try {
      await aiApi.deleteHistory(id);
      qc.invalidateQueries({ queryKey: ['ai-histories'] });
      toast.success('History deleted');
    } catch (err: any) {
      toast.error(apiErrorMessage(err, 'Failed to delete history'));
    }
  };

  const handleDownloadHistory = async (id: string) => {
    try {
      const history = await aiApi.getHistory(id);
      let content = `Title: ${history.title}\nDate: ${new Date(history.createdAt).toLocaleString()}\n\n`;
      history.messages.forEach((msg) => {
        content += `[${msg.role.toUpperCase()}]\n${msg.content}\n\n`;
      });
      
      const blob = new Blob([content], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ai-chat-${id.substring(0, 8)}.txt`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err: any) {
      toast.error(apiErrorMessage(err, 'Failed to download history'));
    }
  };

  const handleViewHistory = async (id: string) => {
    try {
      const history = await aiApi.getHistory(id);
      setViewHistoryData(history);
    } catch (err: any) {
      toast.error(apiErrorMessage(err, 'Failed to view history'));
    }
  };

  const handleContinueHistory = async (id: string) => {
    try {
      const history = await aiApi.getHistory(id);
      setCurrentChatHistory(history.messages as {role: 'user'|'assistant', content: string}[]);
      setActiveTab('console');
      toast.success('Chat loaded into Execution Console');
    } catch (err: any) {
      toast.error(apiErrorMessage(err, 'Failed to load history'));
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader 
        title="AI Operating System — Playground" 
        description="Interact with the AgnoHire AI OS workflow and tool execution brain in real-time."
      />

      <div className="border-b border-border/60">
        <div className="flex gap-6">
          <button
            type="button"
            className={`pb-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'console'
                ? 'border-[#3b6df8] text-[#3b6df8]'
                : 'border-transparent text-text-muted hover:text-text-primary hover:border-border'
            }`}
            onClick={() => setActiveTab('console')}
          >
            Execution Console
          </button>
          <button
            type="button"
            className={`pb-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'history'
                ? 'border-[#3b6df8] text-[#3b6df8]'
                : 'border-transparent text-text-muted hover:text-text-primary hover:border-border'
            }`}
            onClick={() => setActiveTab('history')}
          >
            History
          </button>
        </div>
      </div>

      {activeTab === 'console' ? (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* Execution Console */}
          <div className="space-y-6 lg:col-span-2">
            <div className="rounded-xl border border-slate-800 bg-[#0b1220] shadow-lg flex flex-col h-[500px] overflow-hidden">
              <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3 bg-[#0f1729]">
                <div className="flex items-center gap-2 text-slate-200 font-semibold">
                  <Terminal className="h-4 w-4 text-accent" />
                  <span>Execution Logs</span>
                </div>
                {workflowState && (
                  <Button variant="outline" size="sm" onClick={handleResetWorkflow}>
                    Reset State
                  </Button>
                )}
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-3 font-mono text-sm">
                {currentChatHistory.length === 0 && progressSteps.length === 0 && !output && !loading && (
                  <div className="text-slate-500 text-center py-20">
                    <Sparkles className="h-10 w-10 mx-auto text-accent mb-3 animate-pulse" />
                    <p className="text-slate-400">Send an instruction below to begin execution...</p>
                    <p className="text-xs mt-1">E.g., "Create a Banking sector named Fintech"</p>
                  </div>
                )}

                {currentChatHistory.map((msg, idx) => (
                  <div key={`hist-${idx}`} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} mb-4`}>
                    <div className={`max-w-[85%] rounded-lg px-4 py-2.5 text-sm ${msg.role === 'user' ? 'bg-[#3b6df8] text-white' : 'bg-slate-800 text-slate-200'}`}>
                      {msg.role === 'assistant' && (
                        <div className="flex items-center gap-1.5 mb-1.5 text-accent font-semibold text-xs">
                          <Sparkles className="w-3.5 h-3.5" /> AI Response
                        </div>
                      )}
                      <div className="prose prose-invert max-w-none text-sm">{msg.content}</div>
                    </div>
                  </div>
                ))}

                {progressSteps.map((step, idx) => (
                  <div key={idx} className="flex items-start gap-2">
                    {step.status === 'running' && (
                      <Loader2 className="h-4 w-4 text-accent animate-spin mt-0.5 shrink-0" />
                    )}
                    {step.status === 'success' && (
                      <CheckCircle2 className="h-4 w-4 text-emerald-400 mt-0.5 shrink-0" />
                    )}
                    {step.status === 'failed' && (
                      <XCircle className="h-4 w-4 text-rose-400 mt-0.5 shrink-0" />
                    )}
                    <span className={step.status === 'failed' ? 'text-rose-300' : 'text-slate-300'}>
                      {step.message}
                    </span>
                  </div>
                ))}

                {loading && progressSteps.length > 0 && progressSteps[progressSteps.length - 1].status !== 'running' && (
                  <div className="flex items-center gap-2">
                    <Loader2 className="h-4 w-4 text-accent animate-spin" />
                    <span className="text-slate-500">Awaiting orchestrator response...</span>
                  </div>
                )}

                {output && (
                  <div className="mt-4 pt-4 border-t border-slate-800 font-sans">
                    <div className="font-semibold text-accent mb-2 flex items-center gap-1.5">
                      <Sparkles className="h-3.5 w-3.5" /> Final Response
                    </div>
                    <div className="prose prose-invert max-w-none text-sm text-slate-200">{output}</div>
                  </div>
                )}

                <div ref={bottomRef} />
              </div>
            </div>

            {/* Form */}
            <form onSubmit={handleExecute} className="flex gap-3">
              <input
                type="text"
                placeholder="Enter recruiter instruction (e.g., 'Create a Software Engineer job for Engineering domain')..."
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                className="flex-1 rounded-lg border border-border bg-surface px-4 py-2.5 text-sm text-text-primary placeholder-text-muted focus:border-accent focus:ring-1 focus:ring-accent outline-none"
                disabled={loading}
              />
              <Button type="submit" disabled={loading} className="gap-2">
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Play className="h-4 w-4 fill-current" />
                )}
                <span>Execute</span>
              </Button>
            </form>
          </div>

          {/* Workflow State Sidebar */}
          <div className="space-y-6">
            <div className="rounded-lg border border-border bg-surface shadow-sm">
              <div className="border-b border-border/60 px-4 py-3 bg-surface-raised">
                <h3 className="text-sm font-semibold text-text-primary">Active Workflow Engine</h3>
              </div>
              <div className="p-4 space-y-4">
                <div>
                  <p className="text-xs text-text-muted uppercase font-semibold mb-1">Current Active Step</p>
                  {workflowState ? (
                    <Badge variant="info">{workflowState.currentStepId}</Badge>
                  ) : (
                    <span className="text-sm text-text-muted">No active workflow running.</span>
                  )}
                </div>

                {workflowState?.completedStepIds && workflowState.completedStepIds.length > 0 && (
                  <div>
                    <p className="text-xs text-text-muted uppercase font-semibold mb-2">Completed Steps</p>
                    <ul className="space-y-1 text-sm text-text-secondary list-disc pl-4">
                      {workflowState.completedStepIds.map((stepId: string) => (
                        <li key={stepId}>{stepId}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {workflowState?.context && Object.keys(workflowState.context).length > 0 && (
                  <div>
                    <p className="text-xs text-text-muted uppercase font-semibold mb-2">Active Context Variables</p>
                    <pre className="text-xs font-mono bg-[#0b1220] border border-slate-800 p-3 rounded-lg overflow-x-auto text-emerald-300">
                      {JSON.stringify(workflowState.context, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            </div>

            {actionsRun.length > 0 && (
              <div className="rounded-lg border border-border bg-surface shadow-sm">
                <div className="border-b border-border/60 px-4 py-3 bg-surface-raised">
                  <h3 className="text-sm font-semibold text-text-primary">Executed Actions</h3>
                </div>
                <div className="p-4">
                  <ul className="space-y-3">
                    {actionsRun.map((act, idx) => (
                      <li key={idx} className="flex items-start justify-between gap-2 text-sm">
                        <span className="font-mono text-text-secondary">{act.tool}</span>
                        <Badge variant={act.success ? 'success' : 'danger'}>
                          {act.success ? 'success' : 'failed'}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          {viewHistoryData ? (
            <div className="rounded-lg border border-border bg-surface shadow-sm">
              <div className="border-b border-border/60 px-4 py-3 bg-surface-raised flex items-center justify-between">
                <h3 className="text-sm font-semibold text-text-primary">{viewHistoryData.title}</h3>
                <Button variant="outline" size="sm" onClick={() => setViewHistoryData(null)}>
                  Close
                </Button>
              </div>
              <div className="p-4 space-y-4 max-h-[600px] overflow-y-auto">
                {viewHistoryData.messages.map((msg, idx) => (
                  <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[85%] rounded-[18px] px-4 py-2.5 text-sm leading-relaxed ${
                      msg.role === 'user' 
                        ? 'bg-[#3b6df8] text-white rounded-tr-none' 
                        : 'bg-black/5 text-text-primary rounded-tl-none'
                    }`}>
                      {msg.content}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-border bg-surface shadow-sm overflow-hidden">
              <div className="border-b border-border/60 px-4 py-3 bg-surface-raised">
                <h3 className="text-sm font-semibold text-text-primary">Chat History</h3>
              </div>
              {historyLoading ? (
                <div className="p-8 flex justify-center text-accent">
                  <Loader2 className="animate-spin h-6 w-6" />
                </div>
              ) : histories?.length === 0 ? (
                <div className="p-8 text-center text-text-muted">
                  No history found. Try saving a chat from the bot widget.
                </div>
              ) : (
                <ul className="divide-y divide-border/60">
                  {histories?.map(h => (
                    <li key={h.id} className="p-4 flex items-center justify-between hover:bg-black/5 transition-colors group">
                      <div>
                        <p className="font-medium text-sm text-text-primary">{h.title}</p>
                        <p className="text-xs text-text-muted mt-1">{format(new Date(h.createdAt), 'PPpp')}</p>
                      </div>
                      <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          type="button"
                          onClick={() => handleViewHistory(h.id)}
                          className="p-2 rounded hover:bg-[#eff4ff] text-text-muted hover:text-[#3b6df8] transition-colors"
                          title="View"
                        >
                          <Eye className="h-4.5 w-4.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleContinueHistory(h.id)}
                          className="p-2 rounded hover:bg-[#eff4ff] text-text-muted hover:text-[#3b6df8] transition-colors"
                          title="Continue in Console"
                        >
                          <MessageSquare className="h-4.5 w-4.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDownloadHistory(h.id)}
                          className="p-2 rounded hover:bg-[#eff4ff] text-text-muted hover:text-[#3b6df8] transition-colors"
                          title="Download"
                        >
                          <Download className="h-4.5 w-4.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteHistory(h.id)}
                          className="p-2 rounded hover:bg-red-50 text-text-muted hover:text-danger transition-colors"
                          title="Delete"
                        >
                          <Trash2 className="h-4.5 w-4.5" />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
