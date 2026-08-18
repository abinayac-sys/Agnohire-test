-- Deduplicate answers first: keep the most recent row per (interviewId, questionId).
DELETE FROM "CandidateAnswer" ca
USING "CandidateAnswer" newer
WHERE ca."interviewId" = newer."interviewId"
  AND ca."questionId" = newer."questionId"
  AND (newer."createdAt" > ca."createdAt"
       OR (newer."createdAt" = ca."createdAt" AND newer."id" > ca."id"));

-- One answer row per question per interview (concurrent autosaves now upsert).
CREATE UNIQUE INDEX "CandidateAnswer_interviewId_questionId_key"
  ON "CandidateAnswer"("interviewId", "questionId");
