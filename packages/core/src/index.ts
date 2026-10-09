export const threadKinds = ['fix', 'decided', 'promote', 'experiment'] as const;
export type ThreadKind = (typeof threadKinds)[number];

export const verdicts = ['ship', 'iterate', 'discard'] as const;
export type Verdict = (typeof verdicts)[number];
export * from './diff.ts';
export * from './threads.ts';
export * from './acceptance.ts';

export const repoNamePattern = /^(?!.*--)[A-Za-z0-9._-]+$/;
export const repoNameRule =
	'Use letters, digits, dots, hyphens and underscores, without a double hyphen.';
