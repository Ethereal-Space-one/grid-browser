// Local inspection of a fixed text snapshot. No live page, history or service calls.
namespace SnapshotQuote {
  export type Match = number | 'ambiguous' | 'missing';
  export function match(text: string, quote: string): Match {
    const first = quote ? text.indexOf(quote) : -1;
    if (first < 0) return 'missing';
    // Count overlapping duplicates too: a saved quote has no occurrence selector.
    return text.indexOf(quote, first + 1) < 0 ? first : 'ambiguous';
  }
  export class Inspector {
    private visit?: { opener: HTMLElement; originallyOpen: boolean };
    constructor(private details: HTMLDetailsElement, private body: HTMLElement, private back: HTMLButtonElement) {
      back.addEventListener('click', () => {
        const visit = this.visit;
        if (!visit || !details.open || !visit.opener.isConnected) return;
        this.clear();
        details.open = visit.originallyOpen;
        visit.opener.focus({ preventScroll: true });
        visit.opener.scrollIntoView({ block: 'center', behavior: 'instant' });
      });
      details.addEventListener('toggle', () => { if (!details.open) this.clear(); });
    }
    leave() {
      // Only unwind the temporary inspection, not a snapshot opened manually.
      if (this.visit) this.details.open = this.visit.originallyOpen;
      this.clear();
    }
    clear() {
      this.visit = undefined;
      this.back.hidden = true;
      if (this.body.querySelector('mark')) this.body.textContent = this.body.textContent;
    }
    show(opener: HTMLElement, text: string, quote: string, at: Match) {
      if (!opener.isConnected) return;
      const originallyOpen = this.details.open && (this.visit?.originallyOpen ?? true);
      this.clear();
      this.details.open = true;
      if (typeof at !== 'number') return; // Show plain text; never guess or move focus.
      this.visit = { opener, originallyOpen };
      this.back.hidden = false;
      const mark = document.createElement('mark'); mark.textContent = quote; mark.tabIndex = -1;
      this.body.replaceChildren(document.createTextNode(text.slice(0, at)), mark, document.createTextNode(text.slice(at + quote.length)));
      mark.focus({ preventScroll: true });
      mark.scrollIntoView({ block: 'center', behavior: 'instant' });
    }
  }
}
