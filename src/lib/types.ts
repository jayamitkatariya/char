export type Folder = {
  id: string;
  name: string;
  parentId: string | null;
};

export type Note = {
  id: string;
  folderId: string;
  title: string;
  /** Markdown rendering of the note: used for previews, search, export and the AI. */
  content: string;
  /** BlockNote document as JSON. Older notes only have `content`. */
  blocks?: string;
  /** IDs of notes and folders this note links to with @-mentions. */
  links?: string[];
  createdAt: string;
  updatedAt: string;
  pinned: boolean;
};
