### Learning: exam question explanations (#4650, D4650 part 3)

- **Worker:** `PUT /api/admin/learning/questions/:uid/explanation` in `routes/admin_learning_assessment.ts` (Super Admin). It writes a question's explanation and up to 5 revision links, and is allowed after the first attempt. `POST /exams/:uid/questions` also takes both.
- **Member:** `routes/learning_assessment.ts`'s `attemptView` adds `explanations` beside the revealed answers, only under the attempt's own `score_and_answers` policy.
- **Client:** `lib/api/adminLearning.js` `explainQuestion`, called from `pages/learning/assessmentReads.js` (`explainExamQuestion`). The studio's `StudioAssessmentEditors.jsx` (`ExplanationForm`) writes it, and the member's result in `ExamFlow.jsx` draws it.
