export interface Chapter {
  key: string;
  label: string;
  duration: number | null;
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
