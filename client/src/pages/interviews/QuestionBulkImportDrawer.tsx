import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Upload, Download, FileSpreadsheet, FileText, Sparkles, CheckCircle2, AlertTriangle, Loader2 } from 'lucide-react';
import { Drawer } from '../../components/ui/Drawer.js';
import { Button } from '../../components/ui/Button.js';
import { Badge } from '../../components/ui/Badge.js';
import { cn } from '../../utils/cn.js';
import * as bankApi from '../../services/questionBankApi.js';
import { apiErrorMessage } from '../../services/api.js';
import {
  type CreateQuestionInput,
  type QuestionType,
  type Difficulty,
  type McqOption,
} from '@agnohire/shared';

interface Props {
  open: boolean;
  onClose: () => void;
  bankId: string;
  nextOrderIndex: number;
  onSuccessDraft?: (questions: any[]) => void;
}

type Mode = 'csv' | 'document';

const TYPES = new Set(['MCQ', 'TEXT', 'CODE']);
const DIFFICULTIES = new Set(['EASY', 'MEDIUM', 'HARD']);

const TEMPLATE = [
  'text,type,difficulty,tags,rubric,options',
  // MCQ — choices in the options column, correct one marked with *
  '"What is the time complexity of binary search?",MCQ,EASY,algorithms;search,,"O(log n)*|O(n)|O(n^2)|O(1)"',
  // TEXT (subjective) — graded by AI against the rubric; no options
  '"Explain the difference between TCP and UDP.",TEXT,MEDIUM,networking,"Mentions TCP reliability/ordering and the 3-way handshake vs UDP being connectionless and lower-latency",',
  // CODE (coding) — graded by AI against the rubric; no options
  '"Write a function that reverses a singly linked list.",CODE,HARD,datastructures,"Iterative in-place reversal; O(n) time and O(1) space; handles empty and single-node lists",',
].join('\n');

function downloadTemplate() {
  const blob = new Blob([`${TEMPLATE}\n`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'agnohire-questions-template.csv';
  a.click();
  URL.revokeObjectURL(url);
}

/** Strip a UTF-8 BOM that Excel/Sheets prepend, which would corrupt the first header. */
function stripBom(s: string): string {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

/**
 * Detect the column delimiter from the header line. Excel in many locales
 * (e.g. India/most of Europe) exports CSV with ';', and pasted Google-Sheets
 * data is tab-separated — so we can't assume ','.
 */
function detectDelimiter(firstLine: string): string {
  const candidates = [',', ';', '\t'];
  let best = ',';
  let bestCount = -1;
  for (const d of candidates) {
    let count = 0;
    let inQuotes = false;
    for (let i = 0; i < firstLine.length; i++) {
      const c = firstLine[i];
      if (c === '"') inQuotes = !inQuotes;
      else if (c === d && !inQuotes) count++;
    }
    if (count > bestCount) {
      bestCount = count;
      best = d;
    }
  }
  return best;
}

/** Minimal RFC-4180 CSV parser: handles quoted fields, embedded delimiters/newlines. */
function parseCsv(input: string, delimiter = ','): string[][] {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (inQuotes) {
      if (c === '"') {
        if (input[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === delimiter) { row.push(field); field = ''; }
    else if (c === '\r') { /* skip */ }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

interface ParsedRow {
  line: number;
  payload?: CreateQuestionInput;
  error?: string;
}

function parseOptions(raw: string): McqOption[] {
  return raw
    .split('|')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => (s.endsWith('*') ? { text: s.slice(0, -1).trim(), correct: true } : { text: s, correct: false }));
}

function buildRows(rawCsv: string, startOrder: number): ParsedRow[] {
  const csv = stripBom(rawCsv);
  const firstLine = csv.split(/\r?\n/, 1)[0] ?? '';
  const rows = parseCsv(csv, detectDelimiter(firstLine));
  if (rows.length < 2) return [];
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = (name: string) => header.indexOf(name);
  const ci = { text: col('text'), type: col('type'), difficulty: col('difficulty'), tags: col('tags'), rubric: col('rubric'), options: col('options') };

  return rows.slice(1).map((r, i) => {
    const line = i + 2;
    const get = (idx: number) => (idx >= 0 ? (r[idx] ?? '').trim() : '');
    const text = get(ci.text);
    const type = get(ci.type).toUpperCase() as QuestionType;
    const difficulty = (get(ci.difficulty).toUpperCase() || 'MEDIUM') as Difficulty;
    const tags = get(ci.tags).split(';').map((t) => t.trim()).filter(Boolean);
    const rubric = get(ci.rubric);
    const optionsRaw = get(ci.options);

    if (text.length < 3) return { line, error: 'Question text is too short' };
    if (!TYPES.has(type)) return { line, error: `Invalid type "${type}" (use MCQ/TEXT/CODE)` };
    if (!DIFFICULTIES.has(difficulty)) return { line, error: `Invalid difficulty "${difficulty}"` };

    let options: McqOption[] | undefined;
    if (type === 'MCQ') {
      options = parseOptions(optionsRaw);
      if (options.length < 2) return { line, error: 'MCQ needs at least 2 options' };
      if (!options.some((o) => o.correct)) return { line, error: 'MCQ needs a correct option (mark with *)' };
    }

    return { line, payload: { text, type, difficulty, rubric: rubric || undefined, tags, orderIndex: startOrder + i, options } };
  });
}

export function QuestionBulkImportDrawer({ open, onClose, bankId, nextOrderIndex, onSuccessDraft }: Props) {
  const qc = useQueryClient();
  const [mode, setMode] = useState<Mode>('csv');

  // Spreadsheet state
  const csvRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState('');
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  // Document state
  const docRef = useRef<HTMLInputElement>(null);
  const [docFile, setDocFile] = useState<File | null>(null);

  const valid = rows.filter((r) => r.payload);
  const invalid = rows.filter((r) => r.error);

  function reset() {
    setFileName(''); setRows([]); setParseError(null); setProgress(null); setDocFile(null);
  }
  function close() { reset(); onClose(); }

  function invalidate() {
    qc.invalidateQueries({ queryKey: ['question-bank', bankId] });
    qc.invalidateQueries({ queryKey: ['question-banks'] });
  }

  /** Read the chosen spreadsheet (CSV/TSV/TXT or Excel .xlsx/.xls) into rows. */
  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) e.target.value = '';
    if (!file) return;
    // PDF / Word belong to the document path — hand them off so one upload box
    // accepts every format.
    if (/\.(pdf|docx|doc)$/i.test(file.name)) {
      setMode('document');
      setDocFile(file);
      return;
    }
    setFileName(file.name);
    setProgress(null);
    setParseError(null);
    setRows([]);
    setReading(true);
    try {
      let csvText: string;
      if (/\.(xlsx|xls)$/i.test(file.name)) {
        // Excel → load SheetJS lazily, take the first sheet, emit CSV.
        const XLSX = await import('xlsx');
        const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        if (!sheet) throw new Error('That workbook has no sheets.');
        csvText = XLSX.utils.sheet_to_csv(sheet);
      } else {
        csvText = await file.text();
      }
      const built = buildRows(csvText, nextOrderIndex);
      setRows(built);
      if (built.length === 0) {
        setParseError(
          'No rows found. The first row must contain the column headers (text, type, difficulty, tags, rubric, options).',
        );
      }
    } catch (err) {
      setParseError((err as Error).message || 'Could not read that file.');
    } finally {
      setReading(false);
    }
  }

  function onDoc(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) e.target.value = '';
    if (file) setDocFile(file);
  }

  const csvMutation = useMutation({
    mutationFn: async () => {
      if (onSuccessDraft) {
        return valid.map((row) => ({
          ...row.payload!,
          id: Math.random().toString(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }));
      }
      let done = 0;
      const failures: string[] = [];
      setProgress({ done: 0, total: valid.length });
      for (const row of valid) {
        try { await bankApi.addQuestion(bankId, row.payload!); }
        catch (err) { failures.push(`Line ${row.line}: ${(err as Error).message}`); }
        setProgress({ done: ++done, total: valid.length });
      }
      return failures;
    },
    onSuccess: (res) => {
      if (onSuccessDraft) {
        toast.success(`Imported ${res.length} question${res.length === 1 ? '' : 's'}`);
        onSuccessDraft(res);
        close();
        return;
      }
      const failures = res as string[];
      invalidate();
      const added = valid.length - failures.length;
      if (failures.length === 0) { toast.success(`Imported ${added} question${added === 1 ? '' : 's'}`); close(); }
      else toast.error(`Imported ${added}, ${failures.length} failed`);
    },
    onError: (e: unknown) => toast.error(apiErrorMessage(e)),
  });

  const docMutation = useMutation({
    mutationFn: () => bankApi.importDocument(bankId, docFile!),
    onSuccess: (res) => {
      if (onSuccessDraft) {
        toast.success(`Imported ${res.questions.length} question${res.questions.length === 1 ? '' : 's'} from the document`);
        onSuccessDraft(res.questions);
        close();
        return;
      }
      invalidate();
      toast.success(`Imported ${res.imported} question${res.imported === 1 ? '' : 's'} from the document`);
      close();
    },
    onError: (e: unknown) => toast.error(apiErrorMessage(e)),
  });

  return (
    <Drawer
      open={open}
      onClose={close}
      title="Bulk import questions"
      subtitle="Add many questions at once from a spreadsheet or a document"
      size="lg"
      footer={
        <div className="flex justify-between gap-2">
          <Button variant="outline" type="button" onClick={close}>Cancel</Button>
          {mode === 'csv' ? (
            <Button type="button" disabled={valid.length === 0} loading={csvMutation.isPending} onClick={() => csvMutation.mutate()}>
              <Upload className="h-4 w-4" />
              Import {valid.length > 0 ? valid.length : ''} question{valid.length === 1 ? '' : 's'}
            </Button>
          ) : (
            <Button type="button" disabled={!docFile} loading={docMutation.isPending} onClick={() => docMutation.mutate()}>
              <Sparkles className="h-4 w-4" />
              Extract &amp; import
            </Button>
          )}
        </div>
      }
    >
      {/* Mode tabs */}
      <div className="mb-4 flex gap-1 rounded-lg border border-border bg-surface-raised p-1">
        {([['csv', 'CSV / Excel', FileSpreadsheet], ['document', 'PDF / Word', FileText]] as const).map(([m, label, Icon]) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={cn(
              'flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium transition-colors',
              mode === m ? 'bg-surface text-text-primary shadow-sm' : 'text-text-muted hover:text-text-primary',
            )}
          >
            <Icon className="h-4 w-4" /> {label}
          </button>
        ))}
      </div>

      {mode === 'csv' ? (
        <div className="space-y-4">
          <div className="rounded-lg border border-border bg-surface-raised p-4 text-sm text-text-secondary">
            <p className="font-medium text-text-primary">Spreadsheet format</p>
            <p className="mt-1">
              Upload a <strong className="text-text-primary">CSV</strong> or{' '}
              <strong className="text-text-primary">Excel (.xlsx)</strong> file. Columns:{' '}
              <code className="text-xs">text, type, difficulty, tags, rubric, options</code>.
            </p>
            <Button variant="ghost" size="sm" type="button" className="mt-2" onClick={downloadTemplate}>
              <Download className="h-4 w-4" /> Download template
            </Button>
          </div>

          <input
            ref={csvRef}
            type="file"
            accept=".csv,.tsv,.txt,.xlsx,.xls,.pdf,.docx,.doc,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            className="hidden"
            onChange={onFile}
          />
          <button
            type="button"
            onClick={() => csvRef.current?.click()}
            className="flex w-full flex-col items-center gap-2 rounded-lg border-2 border-dashed border-border py-8 text-text-muted transition-colors hover:border-accent hover:text-accent"
          >
            {reading ? <Loader2 className="h-8 w-8 animate-spin" /> : <FileSpreadsheet className="h-8 w-8" />}
            <span className="text-sm font-medium">
              {reading ? 'Reading file…' : fileName || 'Click to choose a CSV, Excel, PDF or Word file'}
            </span>
          </button>

          {parseError && (
            <div className="flex items-start gap-2 rounded-lg border border-danger-muted bg-danger-muted/30 p-3 text-xs text-danger">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              {parseError}
            </div>
          )}

          {rows.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-3 text-sm">
                <Badge variant="success"><CheckCircle2 className="mr-1 h-3 w-3" />{valid.length} ready</Badge>
                {invalid.length > 0 && <Badge variant="danger"><AlertTriangle className="mr-1 h-3 w-3" />{invalid.length} with errors</Badge>}
              </div>
              {progress && (
                <div>
                  <div className="mb-1 flex justify-between text-xs text-text-muted"><span>Importing…</span><span>{progress.done}/{progress.total}</span></div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-surface-raised">
                    <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} />
                  </div>
                </div>
              )}
              {invalid.length > 0 && (
                <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-danger-muted bg-danger-muted/30 p-3 text-xs text-danger">
                  {invalid.map((r) => <p key={r.line}>Line {r.line}: {r.error}</p>)}
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="rounded-lg border border-border bg-surface-raised p-4 text-sm text-text-secondary">
            <p className="flex items-center gap-1.5 font-medium text-text-primary"><FileText className="h-4 w-4 text-accent" /> PDF / Word import</p>
            <p className="mt-1">
              Upload a <b>PDF</b>, <b>Word (.docx)</b>, or <b>text</b> file containing questions and they’re added to
              this bank.
            </p>
            <p className="mt-2 text-xs text-text-muted">
              If the file has a <b>questions table</b> (same columns as the template), it imports directly — no AI
              needed. Free-form documents are structured by AI, which needs a provider key (Admin Console → System
              Config → AI).
            </p>
          </div>

          <input ref={docRef} type="file" accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain" className="hidden" onChange={onDoc} />
          <button
            type="button"
            onClick={() => docRef.current?.click()}
            className="flex w-full flex-col items-center gap-2 rounded-lg border-2 border-dashed border-border py-8 text-text-muted transition-colors hover:border-accent hover:text-accent"
          >
            <FileText className="h-8 w-8" />
            <span className="text-sm font-medium">{docFile?.name || 'Click to choose a PDF / Word / text file'}</span>
          </button>

          {docMutation.isPending && (
            <p className="flex items-center gap-2 text-sm text-text-muted">
              <Sparkles className="h-4 w-4 animate-pulse text-accent" /> Reading the document and extracting questions…
            </p>
          )}
        </div>
      )}
    </Drawer>
  );
}
