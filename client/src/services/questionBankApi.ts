import { api, unwrap } from './api.js';
import type {
  QuestionBankListItem,
  QuestionBankDetail,
  QuestionItem,
  QuestionBankFilters,
  CreateQuestionBankInput,
  UpdateQuestionBankInput,
  CreateQuestionInput,
  UpdateQuestionInput,
  GenerateQuestionsInput,
  Paginated,
  ApiResponse,
} from '@agnohire/shared';

type R<T> = Promise<T>;

export async function fetchBanks(
  filters: Partial<QuestionBankFilters> = {},
): R<Paginated<QuestionBankListItem>> {
  const res = await api.get<ApiResponse<Paginated<QuestionBankListItem>>>('/question-banks', {
    params: filters,
  });
  return unwrap(res.data);
}

export async function fetchBank(id: string): R<{ bank: QuestionBankDetail }> {
  const res = await api.get<ApiResponse<{ bank: QuestionBankDetail }>>(`/question-banks/${id}`);
  return unwrap(res.data);
}

export async function createBank(
  data: CreateQuestionBankInput,
): R<{ bank: QuestionBankDetail }> {
  const res = await api.post<ApiResponse<{ bank: QuestionBankDetail }>>('/question-banks', data);
  return unwrap(res.data);
}

export async function updateBank(
  id: string,
  data: UpdateQuestionBankInput,
): R<{ bank: QuestionBankDetail }> {
  const res = await api.patch<ApiResponse<{ bank: QuestionBankDetail }>>(
    `/question-banks/${id}`,
    data,
  );
  return unwrap(res.data);
}

export async function deleteBank(id: string): R<{ deleted: boolean }> {
  const res = await api.delete<ApiResponse<{ deleted: boolean }>>(`/question-banks/${id}`);
  return unwrap(res.data);
}

export async function addQuestion(
  bankId: string,
  data: CreateQuestionInput,
): R<{ question: QuestionItem }> {
  const res = await api.post<ApiResponse<{ question: QuestionItem }>>(
    `/question-banks/${bankId}/questions`,
    data,
  );
  return unwrap(res.data);
}

export async function updateQuestion(
  bankId: string,
  qid: string,
  data: UpdateQuestionInput,
): R<{ question: QuestionItem }> {
  const res = await api.patch<ApiResponse<{ question: QuestionItem }>>(
    `/question-banks/${bankId}/questions/${qid}`,
    data,
  );
  return unwrap(res.data);
}

export async function deleteQuestion(
  bankId: string,
  qid: string,
): R<{ deleted: boolean }> {
  const res = await api.delete<ApiResponse<{ deleted: boolean }>>(
    `/question-banks/${bankId}/questions/${qid}`,
  );
  return unwrap(res.data);
}

export async function generateQuestions(
  bankId: string,
  data: GenerateQuestionsInput,
): R<{ questions: QuestionItem[] }> {
  const res = await api.post<ApiResponse<{ questions: QuestionItem[] }>>(
    `/question-banks/${bankId}/generate`,
    data,
  );
  return unwrap(res.data);
}

/** Upload a PDF / Word / text document; the AI extracts questions into the bank. */
export async function importDocument(
  bankId: string,
  file: File,
): R<{ imported: number; questions: QuestionItem[] }> {
  const form = new FormData();
  form.append('file', file);
  const res = await api.post<ApiResponse<{ imported: number; questions: QuestionItem[] }>>(
    `/question-banks/${bankId}/import-document`,
    form,
  );
  return unwrap(res.data);
}

export async function downloadBanksPdf(ids: string[]): Promise<void> {
  const res = await api.get('/question-banks/export', {
    params: { ids: ids.join(',') },
    responseType: 'blob',
  });
  const blob = new Blob([res.data as any], { type: 'application/pdf' });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  
  const disposition = res.headers['content-disposition'];
  let filename = ids.length === 1 ? 'Question_Bank.pdf' : 'Question_Banks.pdf';
  if (disposition && disposition.includes('filename=')) {
    const match = disposition.match(/filename="(.+?)"/);
    if (match && match[1]) filename = match[1];
  }
  
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}
