/** Module 7 — AI Analytics & Reporting. Aggregate read-models (no DB model of
 *  their own beyond AnalyticsSnapshot). All numbers are computed on the fly. */

export interface KpiSummary {
  totalJobs: number;
  openJobs: number;
  totalCandidates: number;
  totalApplications: number;
  interviewsTotal: number;
  interviewsCompleted: number;
  assessmentsAssigned: number;
  assessmentsPassed: number;
  offersExtended: number;
  hires: number;
  avgFitScore: number | null;
  offerAcceptanceRate: number | null;
  avgTimeToHireDays: number | null;
  interviewsPassed: number;
  interviewsFailed: number;
  interviewsHold: number;
  interviewsValidationRate: number | null;
  avgInterviewScore: number | null;
}

/** One stage of the recruitment funnel, with conversion vs. the prior stage. */
export interface FunnelStage {
  stage: string;
  count: number;
  /** % of the funnel's top stage (0–100). */
  ofTop: number;
  /** % converted from the immediately preceding stage (0–100, null for top). */
  fromPrev: number | null;
}

export interface TimeSeriesPoint {
  /** Bucket start, ISO date (YYYY-MM-DD). */
  date: string;
  applications: number;
  interviews: number;
  hires: number;
}

export interface BreakdownSlice {
  label: string;
  count: number;
}

export interface JobMetric {
  jobTitle: string;
  totalApplications: number;
  schedulesScheduled: number;
  schedulesPassed: number;
  schedulesFailed: number;
  interviewsScheduled: number;
  interviewsPassed: number;
  interviewsFailed: number;
  offersSent: number;
  joined: number;
}

export interface AnalyticsDashboard {
  kpis: KpiSummary;
  funnel: FunnelStage[];
  timeSeries: TimeSeriesPoint[];
  jobsByStatus: BreakdownSlice[];
  applicationsByStatus: BreakdownSlice[];
  candidatesBySource: BreakdownSlice[];
  interviewsByStatus: BreakdownSlice[];
  topDomains: BreakdownSlice[];
  jobMetrics: JobMetric[];
  range: { from: string; to: string; granularity: string };
  generatedAt: string;
}

export interface AnalyticsInsights {
  /** Narrative summary; null when the AI key is not configured. */
  summary: string | null;
  highlights: string[];
  generated: boolean;
}

export interface AnalyticsSnapshotItem {
  id: string;
  period: string;
  snapshotAt: string;
  data: AnalyticsDashboard;
}
