export type Folder = {
  id: string;
  name: string;
  parentId: string | null;
};

export type Note = {
  id: string;
  /** Subpages share their top page's folder, so folder views and counts include them. */
  folderId: string;
  /** The page this one sits inside (a subpage), or null/absent for a page directly in its folder. */
  parentId?: string | null;
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
  /** Set while the note is in the Trash; notes there for 30 days are deleted for good. */
  deletedAt?: string | null;
};
