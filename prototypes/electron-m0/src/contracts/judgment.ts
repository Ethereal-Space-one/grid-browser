import { z } from 'zod';
import type { Scene } from './browsing';

export const judgmentEditSchema = z.object({
  draftId: z.string().min(1).max(256), revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  text: z.string().max(4000), checks: z.string().max(2000), citationIds: z.array(z.string().min(1).max(256)).max(24)
}).strict();
export type JudgmentEdit = z.infer<typeof judgmentEditSchema>;
export const judgmentSaveSchema = z.object({ draftId: z.string().min(1).max(256), revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) }).strict();
export type JudgmentSave = z.infer<typeof judgmentSaveSchema>;
export type JudgmentCitation = Readonly<{
  id: string; title: string; url: string; readingId: string; fetchedAt: string; truncated: boolean; quote: string;
}>;
export type Judgment = Readonly<{
  id: string; draftId: string; lineageId: string; revision: number; status: 'draft' | 'saved'; version: number;
  basedOnId?: string; originEntryId: string; originKind: 'question' | 'comparison'; originRecordId: string;
  scene: Scene; topic: string; modelNote: string; citations: readonly JudgmentCitation[];
  citationIds: readonly string[]; text: string; checks: string; savedAt?: string;
}>;
// Path metadata deliberately contains neither the user's text nor quotes/model output.
export type JudgmentScope = Readonly<Pick<Judgment, 'id' | 'lineageId' | 'status' | 'version' | 'originEntryId' | 'originKind' | 'originRecordId' | 'savedAt'>>;
export function judgmentScope(value: Judgment): JudgmentScope {
  const { id, lineageId, status, version, originEntryId, originKind, originRecordId, savedAt } = value;
  return Object.freeze({ id, lineageId, status, version, originEntryId, originKind, originRecordId, savedAt });
}
