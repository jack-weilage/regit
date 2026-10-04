export interface DiffLine {
	kind: 'context' | 'added' | 'removed';
	old?: number;
	new?: number;
	text: string;
}

export interface DiffHunk {
	skipped: number;
	context?: string;
	lines: DiffLine[];
}

export interface DiffFile {
	path: string;
	oldPath?: string;
	change: 'added' | 'modified' | 'deleted' | 'renamed';
	additions: number;
	deletions: number;
	hunks: DiffHunk[];
	binary?: boolean;
	tooLarge?: boolean;
}

export interface DiffSummary {
	files: number;
	additions: number;
	deletions: number;
}

export function summarize(files: DiffFile[]): DiffSummary {
	return {
		files: files.length,
		additions: files.reduce((sum, file) => sum + file.additions, 0),
		deletions: files.reduce((sum, file) => sum + file.deletions, 0)
	};
}
