// Stands in for #lib/data.remote.ts in browser tests, which can't load server code.
const service = (name: string) => ({
	name,
	command: `bun run ${name}`,
	port: 5173,
	saved: true,
	status: 'stopped' as const,
	exitCode: null,
	preview: `https://${name}.example`
});

const detail = (id: string, number: number) => ({
	summary: {
		id,
		number,
		headline: `Thread ${number}`,
		status: 'working' as const,
		mode: 'small' as const,
		auto: false,
		machine: 'basic',
		updatedAt: 0,
		deleted: null,
		parent: null,
		changes: null,
		shipped: null,
		failure: null,
		behind: { branch: 'main', commits: 2, sha: 'abc1234def', headline: 'Bump deps', conflicts: [] },
		checks: null,
		needsYou: false
	},
	entries: [],
	activity: null,
	services: [service('web'), service('worker')],
	automations: [],
	usage: { context: { used: 0, limit: 100_000 }, rows: [] },
	branch: 'main'
});

export const fakeThreads = {
	a: { id: 'aaaaaaaaaaaa', number: 1 },
	b: { id: 'bbbbbbbbbbbb', number: 2 }
};

const threads = Object.fromEntries(
	Object.values(fakeThreads).map(({ id, number }) => [id, detail(id, number)])
);

const query =
	<A, R>(read: (arg: A) => R) =>
	(arg: A) =>
		Object.assign(Promise.resolve(read(arg)), { refresh: () => Promise.resolve() });
const command = async (_: unknown) => {};

export const getThread = query(({ id }: { id: string }) => threads[id] ?? null);
export const getThreads = query((_: string) => []);
export const getChildren = query((_: { id: string }) => []);
export const getChanges = query((_: { id: string }) => []);
export const getUser = query(() => ({ name: 'Ada' }));
export const getRepos = query(() => [{ name: 'demo', machine: 'basic', role: 'owner' as const }]);
export const readServiceLogs = async ({ id, name }: { id: string; name: string }) =>
	`${name} logs of ${id}`;
// Never finishes, so the thread stays "Updating…".
export const bringThreadUpToDate = (_: { id: string }) => new Promise<void>(() => {});
export {
	command as archiveThread,
	command as cancelAutomation,
	command as deleteThread,
	command as dismissSuggestion,
	command as forwardIntent,
	command as reopenThread,
	command as reply,
	command as restoreThread,
	command as resumeThread,
	command as retryThreadNow,
	command as serviceAction,
	command as shipThread,
	command as spinOff,
	command as stopThread
};
