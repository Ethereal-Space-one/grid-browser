import { z } from 'zod';
import type { QueryContext, Scene } from './browsing';
import type { QuestionSource } from './understanding';

const id = z.string().min(1).max(256);
export const comparisonSelectorSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('result'), searchId: id, index: z.number().int().min(0).max(99) }).strict(),
  z.object({ kind: z.literal('reading'), readingId: id }).strict(),
  z.object({ kind: z.literal('question'), questionId: id }).strict()
]);
export type ComparisonSelector = z.infer<typeof comparisonSelectorSchema>;
export type ComparisonSource = Readonly<{
  id: string; originEntryId: string; url: string; title: string; context?: QueryContext;
  source?: QuestionSource; issue?: string;
}>;
export type ComparisonSide = Readonly<{ status: 'supported' | 'not-stated'; text: string; quotes: readonly string[] }>;
export type ComparisonRow = Readonly<{
  aspect: string; relation: 'agreement' | 'conflict' | 'different-scope' | 'insufficient';
  left: ComparisonSide; right: ComparisonSide;
}>;
export type ComparisonAnalysis = Readonly<{ overview: string; rows: readonly ComparisonRow[]; limitations: string }>;
export type ComparisonRecord = Readonly<{
  id: string; scene: Scene; context?: QueryContext; topic: string;
  sources: readonly ComparisonSource[]; analysis?: ComparisonAnalysis; generatedAt?: string;
}>;
export type ComparisonRequest = Readonly<{ scene: Scene; topic: string; sources: readonly QuestionSource[] }>;
export type ComparisonScope = Readonly<{
  scene: Scene; context?: QueryContext; topic: string;
  sources: readonly Readonly<Omit<ComparisonSource, 'source' | 'issue'> & { version?: Readonly<Pick<QuestionSource, 'readingId' | 'fetchedAt' | 'truncated'>> }>[];
}>;
/** Keep the source handles when payloads are evicted; never copy raw text or model output here. */
export function comparisonScope(record: ComparisonRecord): ComparisonScope {
  return Object.freeze({ scene: record.scene, context: record.context, topic: record.topic,
    sources: Object.freeze(record.sources.map(item => Object.freeze({ id: item.id, title: item.title, url: item.url,
      originEntryId: item.originEntryId, context: item.context, version: item.source && Object.freeze({ readingId: item.source.readingId,
        fetchedAt: item.source.fetchedAt, truncated: item.source.truncated }) }))) });
}
