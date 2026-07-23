export interface Chapter {
  key: string;
  label: string;
  duration: number | null;
  /** Sorted, ascending timestamps (seconds) within this chapter's audio where the
   * listener has manually marked a split point, for navigation purposes only —
   * the underlying audio file is never re-encoded. */
  markers?: number[];
}

export interface Book {
  id: string;
  title: string;
  author: string;
  chapters: Chapter[];
  coverKey: string | null;
  addedAt: string;
}

export interface Library {
  books: Book[];
}
