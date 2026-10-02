export const threadKinds = ['fix', 'decided', 'promote', 'experiment'] as const;
export type ThreadKind = (typeof threadKinds)[number];

export const verdicts = ['ship', 'iterate', 'discard'] as const;
export type Verdict = (typeof verdicts)[number];
