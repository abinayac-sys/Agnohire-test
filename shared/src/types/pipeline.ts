/** Module 9 — ATS Pipeline / Kanban. A stage board over JobApplication records,
 *  with per-application pipeline notes. */
import type { ApplicationStatus, FitRecommendation } from '../constants/enums.js';

export interface PipelineCard {
  id: string;
  stage: string;
  status: ApplicationStatus;
  fitScore: number | null;
  fitRecommendation: FitRecommendation | null;
  appliedAt: string;
  updatedAt: string;
  noteCount: number;
  candidate: {
    id: string;
    fullName: string;
    email: string;
    currentRole: string | null;
    avatarUrl: string | null;
  };
  rejectionReason?: string | null;
  rejectedRound?: string | null;
  aiRejectionReason?: string | null;
  aiRejectedRound?: string | null;
}

export interface PipelineColumn {
  stage: string;
  count: number;
  cards: PipelineCard[];
}

export interface PipelineBoard {
  job: { id: string; title: string };
  stages: string[];
  columns: PipelineColumn[];
  total: number;
}

export interface PipelineNoteItem {
  id: string;
  content: string;
  isPrivate: boolean;
  createdAt: string;
  author: { id: string; name: string };
}
