import type { ReadingDocument, Scene, SearchResponse } from './browsing';

export type ModelSource = Readonly<{ id: number; title: string; url: string; text: string }>;
export type ModelRequest = Readonly<{ kind: 'summary' | 'question'; scene: Scene; question: string; sources: readonly ModelSource[] }>;
export type GroundedText = Readonly<{
  text: string; insufficient: boolean;
  citations: readonly Readonly<{ source: number; quote: string; title: string; url: string }>[];
}>;
export type SearchSummary = GroundedText & Readonly<{ id: string; searchId: string; generatedAt: string;
  pageSource?: Readonly<Pick<QuestionSource,'readingId'|'title'|'url'|'fetchedAt'|'truncated'>> }>;
export type QuestionSource = Readonly<{
  readingId: string; title: string; url: string; fetchedAt: string; text: string; truncated: boolean; released?: true;
}>;
export type PageQuestion = Readonly<{
  id: string; originEntryId: string; url: string; title: string; originKind: 'page' | 'reading';
  scene: Scene; question: string; source?: QuestionSource; answer?: GroundedText; answeredAt?: string;
}>;
export function questionSource(reading: ReadingDocument): QuestionSource {
  const characters = Array.from(reading.content);
  return Object.freeze({ readingId: reading.id, title: reading.title, url: reading.url, fetchedAt: reading.fetchedAt,
    text: characters.slice(0, 16000).join(''), truncated: characters.length > 16000 });
}
export function summarySources(search: SearchResponse): readonly ModelSource[] {
  return Object.freeze(search.results.slice(0, 10).map((hit, index) => Object.freeze({ id: index + 1,
    title: hit.title, url: hit.url, text: Array.from(hit.snippet).slice(0, 1600).join('') })).filter(source => source.text.trim()));
}
