/** Runtime-only chrome projection. Quotes and document capabilities never cross this boundary. */
export type QuoteLocatorStatus = 'ready' | 'locating' | 'found' | 'ambiguous' | 'missing' | 'unsupported' | 'uncertain';
export type QuoteLocatorState = Readonly<{
  id: string; citationId: string; sourceTitle: string; sourceUrl: string;
  status: QuoteLocatorStatus; message: string;
}>;
