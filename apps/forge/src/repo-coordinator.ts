import { DurableObject } from 'cloudflare:workers';
import {
	cost,
	describeTask,
	assessRequest,
	maxSimilarCandidates,
	type Assessment,
	models,
	modes,
	type Intent,
	type Step,
	type ServiceInfo,
	type Suggestion,
	type Usage
} from '@regit/agent';
import type {
	Author,
	Entry,
	DiffFile,
	DiffSummary,
	LiveMessage,
	Machine,
	Mode,
	ModeChoice,
	RepoCoordinatorApi,
	ShipInput,
	StartupStage,
	ThreadActivity,
	ThreadDetail,
	ThreadService,
	ThreadStatus,
	ThreadSummary,
	ThreadUsage,
	ToolCallRecord,
	UsageRow
} from '@regit/core';
import { defaultMachine, threadPurgeDelayMs } from '@regit/core';
import { promotionProblem, type DependencyPin } from '@regit/core';
import { canAccessRepository } from '@regit/db';
import { db } from './db.ts';
import { Acceptance } from './acceptance.ts';
import { Images } from './images.ts';
import type { AttemptStatus } from './attempt-sandbox.ts';

export type AttemptUpdate =
	| { type: 'step'; step: Step & { checkpoint?: string }; tools?: ToolCallRecord[] }
	| { type: 'status'; status: AttemptStatus; error: string | null }
	| { type: 'reply'; step: Step; tools?: ToolCallRecord[] }
	| { type: 'activity'; activity: ThreadActivity }
	| { type: 'startup'; stages: StartupStage[] }
	| { type: 'conversation-failed'; error: string }
	| { type: 'read'; entries: string[] }
	| { type: 'changes'; summary: DiffSummary }
	| { type: 'services'; services: ServiceInfo[]; preview: string }
	| { type: 'usage'; task: UsageRow['task']; model: string; usage: Usage[] };

type ThreadRow = {
	id: string;
	headline: string;
	status: ThreadStatus;
	mode: Mode;
	auto: number | null;
	machine: Machine | null;
	updated_at: number;
	reopen_status: ThreadStatus | null;
	deleted_at: number | null;
	deleted_by: string | null;
	changes: string | null;
	shipped_sha: string | null;
	shipped_by: string | null;
	shipped_at: number | null;
	parent: string | null;
	context: string | null;
	services: string | null;
	preview: string | null;
	parent_headline?: string | null;
};

const agent: Author = { name: 'ReGit', kind: 'agent' };
const maxThreadMessages = 5;
const similarTimeoutMs = 4000;
const recentHistory = 12;
const maxSearchHits = 30;
const maxDiffChars = 20_000;
const pastTense: Record<string, string> = {
	read_file: 'Read',
	write_file: 'Wrote',
	edit_file: 'Edited',
	find_files: 'Found files',
	search: 'Searched for',
	run: 'Ran',
	ask_threads: 'Asked about threads:',
	message_thread: 'Messaged thread'
};

function historyLines(entries: Entry[]) {
	return entries
		.flatMap((entry): string[] => {
			if (entry.type === 'message') return [`${entry.author.name}: ${entry.text}`];
			if (entry.type === 'thread-message') {
				const way = entry.direction === 'in' ? 'From' : 'To';
				return [`${way} thread ${entry.thread} (${entry.headline || 'New thread'}): ${entry.text}`];
			}
			if (entry.type === 'event') return [`· ${entry.text}`];
			if (entry.type === 'intent')
				return [`Intent: ${entry.intent.headline} — ${entry.intent.purpose}`];
			if (entry.type === 'suggestion') return [`Suggested a thread: ${entry.intent.headline}`];
			if (entry.type === 'tools') {
				const calls = entry.calls.map((call) =>
					`${pastTense[call.tool] ?? call.tool} ${call.target}${call.status === 'failed' ? ' (failed)' : ''}`.trim()
				);
				return [`ReGit: ${calls.join('; ')}`];
			}
			return [];
		})
		.map((line, index, all) => {
			const text = line.length > 500 ? `${line.slice(0, 500)}…` : line;
			return `#${index + 1} of ${all.length}: ${text}`;
		});
}

function renderDiff(file: DiffFile) {
	const header = `--- ${file.path} (${file.change}, +${file.additions} −${file.deletions})`;
	if (file.binary || file.tooLarge)
		return `${header}\n(${file.binary ? 'binary' : 'too large to show'})`;
	const prefix = { context: ' ', added: '+', removed: '-' };
	const hunks = file.hunks.map((hunk) =>
		[
			`@@ ${hunk.context ?? ''}`.trimEnd(),
			...hunk.lines.map((line) => `${prefix[line.kind]}${line.text}`)
		].join('\n')
	);
	return [header, ...hunks].join('\n');
}

function describeIntent({ headline, purpose, doneWhen }: Intent) {
	const checks = doneWhen.length ? ` Done when: ${doneWhen.join('; ')}` : '';
	return `${headline} — ${purpose}${checks}`;
}

export class RepoCoordinator extends DurableObject<Env> implements RepoCoordinatorApi {
	#sql = this.ctx.storage.sql;
	#activities = new Map<string, ThreadActivity>();
	#acceptance = new Acceptance(this.#sql);
	#images = new Images(this.#sql);

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		this.#sql.exec(`
			CREATE TABLE IF NOT EXISTS threads (
				id TEXT PRIMARY KEY,
				headline TEXT NOT NULL,
				status TEXT NOT NULL,
				mode TEXT NOT NULL,
				updated_at INTEGER NOT NULL,
				reopen_status TEXT,
				deleted_at INTEGER,
				deleted_by TEXT,
				machine TEXT,
				changes TEXT,
				shipped_sha TEXT,
				shipped_by TEXT,
				shipped_at INTEGER,
				parent TEXT,
				context TEXT,
				services TEXT,
				preview TEXT,
				auto INTEGER
			);
			CREATE TABLE IF NOT EXISTS entries (
				seq INTEGER PRIMARY KEY AUTOINCREMENT,
				thread TEXT NOT NULL,
				body TEXT NOT NULL
			);
			CREATE INDEX IF NOT EXISTS entries_by_thread ON entries (thread, seq);
			CREATE TABLE IF NOT EXISTS usage (
				seq INTEGER PRIMARY KEY AUTOINCREMENT,
				thread TEXT NOT NULL,
				task TEXT NOT NULL,
				model TEXT NOT NULL,
				input_tokens INTEGER NOT NULL,
				cached_input_tokens INTEGER NOT NULL,
				cache_write_tokens INTEGER NOT NULL,
				output_tokens INTEGER NOT NULL,
				at INTEGER NOT NULL
			);
			CREATE INDEX IF NOT EXISTS usage_by_thread ON usage (thread, seq);
			CREATE TABLE IF NOT EXISTS meta (
				key TEXT PRIMARY KEY,
				value TEXT NOT NULL
			);
			CREATE TABLE IF NOT EXISTS run_dispatch (
				id TEXT PRIMARY KEY,
				proposal TEXT NOT NULL,
				previous TEXT NOT NULL,
				input TEXT NOT NULL
			);
		`);
	}

	async openThread({
		repo,
		author,
		text,
		mode,
		machine
	}: {
		repo: string;
		author: Author;
		text: string;
		mode: ModeChoice;
		machine: Machine;
	}): Promise<ThreadSummary> {
		const auto = mode === 'auto';
		const size = auto ? ((await this.#assess(text))?.size ?? 'medium') : mode;
		this.#sql.exec(
			'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT DO NOTHING',
			'repo',
			repo
		);
		const id = crypto.randomUUID().replaceAll('-', '').slice(0, 12);
		this.#sql.exec(
			`INSERT INTO threads (id, headline, status, mode, auto, machine, updated_at) VALUES (?, ?, 'draft', ?, ?, ?, ?)`,
			id,
			headlineFrom(text),
			size,
			auto ? 1 : 0,
			machine,
			Date.now()
		);
		const entry = this.#add(id, { type: 'message', author, text });
		await this.#converse(id, author, text, entry);
		return this.#summary(id)!;
	}

	async reply(thread: string, { author, text }: { author: Author; text: string }) {
		const summary = this.#active(thread);
		const steering = ['running', 'shipping'].includes(summary.status);
		const entry = this.#add(thread, {
			type: 'message',
			author,
			text,
			...(steering && { steering: { read: false } })
		});
		if (steering || ['draft', 'needs-you', 'shipped'].includes(summary.status)) {
			await this.#converse(thread, author, text, entry);
		}
		if (
			summary.status === 'needs-you' &&
			this.#acceptance.run(thread)?.intent === this.#acceptance.intent(thread)?.id
		)
			this.#setStatus(thread, 'running');
	}

	async acceptIntent(thread: string, by: Author) {
		this.#active(thread);
		this.#assertDependencyChangeAllowed(thread);
		const intent = this.#latestIntent(thread);
		if (!intent) throw new Error('There is no proposed intent');
		const current = this.#acceptance.intent(thread);
		if (current && JSON.stringify(current.intent) === JSON.stringify(intent)) return;
		this.#acceptance.putIntent({
			id: crypto.randomUUID(),
			proposal: thread,
			intent,
			acceptedBy: by,
			dependencies: current?.dependencies ?? [],
			at: Date.now()
		});
		for (const p of this.#acceptance
			.promotions()
			.filter((p) => p.proposal === thread && ['queued', 'preparing', 'ready'].includes(p.status)))
			this.#acceptance.putPromotion({
				...p,
				status: 'cancelled',
				error: 'The accepted intent changed'
			});
		this.#add(thread, { type: 'event', text: `${by.name} accepted the intent` });
		this.#invalidateDependencies(thread);
	}

	async pinDependency(thread: string, dependency: string, by: Author) {
		await this.#dependencyEditor(by);
		const accepted = this.#editableDependencies(thread);
		this.#active(dependency);
		if (this.#acceptance.dependsOn(dependency, thread)) throw new Error('Dependency cycle');
		const run = this.#acceptance.run(dependency);
		const revision = await this.#executor(dependency).revision();
		this.#editableDependencies(thread);
		this.#active(dependency);
		if (this.#acceptance.intent(thread)?.id !== accepted.id)
			throw new Error('Intent changed while pinning; try again');
		if (this.#acceptance.dependsOn(dependency, thread)) throw new Error('Dependency cycle');
		if (
			!run ||
			!revision ||
			this.#acceptance.run(dependency)?.id !== run.id ||
			revision.intent !== this.#acceptance.intent(dependency)?.id
		)
			throw new Error('Dependency needs a stable revision of its accepted intent');
		this.#acceptance.putRevision(revision);
		const pin = {
			proposal: dependency,
			revision: revision.id,
			intent: revision.intent,
			sha: revision.sha
		};
		const pins = accepted.dependencies ?? [];
		if (pins.some((p) => p.proposal === dependency && p.revision === revision.id)) return;
		this.#saveDependencies(thread, [...pins.filter((p) => p.proposal !== dependency), pin], by);
	}

	async unpinDependency(thread: string, dependency: string, by: Author) {
		await this.#dependencyEditor(by);
		const accepted = this.#editableDependencies(thread);
		const pins = accepted.dependencies ?? [];
		if (!pins.some((p) => p.proposal === dependency)) return;
		this.#saveDependencies(
			thread,
			pins.filter((p) => p.proposal !== dependency),
			by
		);
	}

	async #dependencyEditor(by: Author) {
		if (by.kind !== 'person' || !(await canAccessRepository(db, this.#repo(), by.id, 'editor')))
			throw new Error('Repository editor permission is required');
	}

	#editableDependencies(thread: string) {
		if (!['draft', 'needs-you'].includes(this.#active(thread).status))
			throw new Error('Stop the current work before changing dependencies');
		this.#assertDependencyChangeAllowed(thread);
		const accepted = this.#acceptance.intent(thread);
		if (!accepted) throw new Error('Accept the intent before pinning dependencies');
		return accepted;
	}

	#saveDependencies(thread: string, dependencies: DependencyPin[], by: Author) {
		const accepted = this.#editableDependencies(thread);
		this.#cancelPromotions(thread);
		this.#acceptance.putIntent({
			...accepted,
			id: crypto.randomUUID(),
			dependencies,
			acceptedBy: by,
			at: Date.now()
		});
		this.#add(thread, {
			type: 'event',
			text: `${by.name} changed dependency pins; start a new run.`
		});
		this.#invalidateDependencies(thread);
	}

	#assertDependencyChangeAllowed(thread: string) {
		if (
			this.#acceptance
				.promotions()
				.some((p) => p.status === 'publishing' && this.#acceptance.dependsOn(p.proposal, thread))
		)
			throw new Error('A dependent publication is being reconciled; wait before changing intent');
	}

	#requireDependencies(thread: string) {
		const states = this.#acceptance.dependencies(thread);
		const blocked = states.find((dependency) => dependency.status !== 'ready');
		if (blocked) throw new Error(`Dependency ${blocked.pin.proposal}: ${blocked.reason}`);
		return states.map((dependency) => dependency.published!);
	}

	#invalidateDependencies(upstream: string) {
		for (const p of this.#acceptance.promotions()) {
			if (!['queued', 'preparing', 'ready'].includes(p.status)) continue;
			if (!this.#acceptance.dependencies(p.proposal).some((d) => d.status !== 'ready')) continue;
			this.#acceptance.putPromotion({
				...p,
				status: 'cancelled',
				error: 'Dependency changed; repin and start a new run.'
			});
			if (this.#summary(p.proposal)?.status === 'shipping')
				this.#setStatus(p.proposal, 'needs-you');
		}
		for (const summary of this.threads())
			if (this.#acceptance.dependsOn(summary.id, upstream)) this.#touch(summary.id);
	}

	async start(thread: string, by: Author = { name: 'Repository member', kind: 'person' }) {
		const summary = this.#active(thread);
		if (!['draft', 'needs-you'].includes(summary.status))
			throw new Error('Stop the current work before starting a new run');
		await this.acceptIntent(thread, by);
		if (!['draft', 'needs-you'].includes(this.#active(thread).status))
			throw new Error('Another run has already started');
		this.#cancelPromotions(thread);
		const accepted = this.#acceptance.intent(thread)!;
		const requiredCommits = this.#requireDependencies(thread);
		const previous = this.#acceptance.run(thread)?.id ?? thread;
		const run = {
			id: crypto.randomUUID().replaceAll('-', ''),
			proposal: thread,
			intent: accepted.id,
			mode: summary.mode,
			machine: summary.machine,
			status: 'queued',
			createdAt: Date.now()
		};
		this.#acceptance.putRun(run);
		this.#setStatus(thread, 'running');
		this.#sql.exec(
			'INSERT INTO run_dispatch (id, proposal, previous, input) VALUES (?, ?, ?, ?)',
			run.id,
			thread,
			previous,
			JSON.stringify({
				proposal: thread,
				intentVersion: accepted.id,
				requiredCommits,
				task: describeTask(accepted.intent, this.#conversation(thread)),
				mode: summary.mode,
				machine: summary.machine,
				repo: this.#repo()
			})
		);
		this.#add(thread, { type: 'event', text: `Started run ${run.id.slice(0, 8)}` });
		await this.#schedulePurge();
		await this.#dispatchRuns();
	}

	async discard(thread: string, by: Author) {
		const summary = this.#active(thread);
		this.#cancelPromotions(thread);
		if (summary.status === 'discarded') return;
		const reopen = summary.status === 'running' ? 'needs-you' : summary.status;
		this.#sql.exec('UPDATE threads SET reopen_status = ? WHERE id = ?', reopen, thread);
		this.#add(thread, { type: 'event', text: `Discarded by ${by.name}` });
		this.#setStatus(thread, 'discarded');
		if (summary.status === 'running') {
			await this.#executor(thread).cancel();
		}
	}

	reopen(thread: string, by: Author) {
		const summary = this.#active(thread);
		if (summary.status !== 'discarded') return;
		const [row] = this.#sql
			.exec<Pick<ThreadRow, 'reopen_status'>>(
				'SELECT reopen_status FROM threads WHERE id = ?',
				thread
			)
			.toArray();
		this.#add(thread, { type: 'event', text: `Reopened by ${by.name}` });
		this.#setStatus(thread, row?.reopen_status ?? 'needs-you');
	}

	// TODO: once threads ship, keep a tombstone (headline, author, commit) instead of purging shipped threads
	async delete(thread: string, by: Author) {
		const summary = this.#active(thread);
		this.#cancelPromotions(thread);
		this.#sql.exec(
			'UPDATE threads SET deleted_at = ?, deleted_by = ? WHERE id = ?',
			Date.now(),
			by.name,
			thread
		);
		this.#touch(thread);
		await this.#schedulePurge();
		if (summary.status === 'running') {
			await this.#executor(thread).cancel();
		}
	}

	async stop(thread: string, by: Author) {
		const summary = this.#active(thread);
		this.#cancelPromotions(thread);
		await this.#executor(thread).stop();
		const pending = this.#sql
			.exec<{ seq: number; body: string }>('SELECT seq, body FROM entries WHERE thread = ?', thread)
			.toArray()
			.filter((row) => {
				const entry = JSON.parse(row.body) as Entry;
				return entry.type === 'message' && entry.steering?.read === false;
			});
		for (const row of pending) this.#markRead(thread, `e${row.seq}`);
		this.#add(thread, { type: 'event', text: `Stopped by ${by.name}` });
		if (['running', 'shipping'].includes(summary.status)) {
			this.#setStatus(thread, 'needs-you');
		}
	}

	restore(thread: string) {
		this.#require(thread);
		this.#sql.exec('UPDATE threads SET deleted_at = NULL, deleted_by = NULL WHERE id = ?', thread);
		this.#touch(thread);
	}

	async #dispatchRuns() {
		const dispatches = this.#sql
			.exec<{ id: string; proposal: string; previous: string; input: string }>(
				'SELECT * FROM run_dispatch'
			)
			.toArray();
		for (const dispatch of dispatches) {
			const runnable = () => {
				const summary = this.#summary(dispatch.proposal);
				return (
					summary &&
					!summary.deleted &&
					summary.status === 'running' &&
					this.#acceptance.run(dispatch.proposal)?.id === dispatch.id
				);
			};
			if (runnable()) {
				await this.env.ATTEMPTS.getByName(dispatch.previous).stop();
				if (runnable())
					await this.env.ATTEMPTS.getByName(dispatch.id).start(JSON.parse(dispatch.input));
			}
			this.#sql.exec('DELETE FROM run_dispatch WHERE id = ?', dispatch.id);
		}
	}

	override async alarm() {
		await this.#dispatchRuns();
		await this.#advancePromotion();
		const due = this.#sql
			.exec<{ id: string }>(
				'SELECT id FROM threads WHERE deleted_at IS NOT NULL AND deleted_at <= ?',
				Date.now() - threadPurgeDelayMs
			)
			.toArray();
		for (const { id } of due) {
			// Acceptance records and referenced Git forks outlive the conversational view.
			for (const run of this.#acceptance.control(id).runs)
				await this.env.ATTEMPTS.getByName(run.id).destroy();
			await this.env.ATTEMPTS.getByName(id).destroy();
			this.#images.purge(id);
			this.#sql.exec('DELETE FROM entries WHERE thread = ?', id);
			this.#sql.exec('DELETE FROM usage WHERE thread = ?', id);
			this.#sql.exec('DELETE FROM threads WHERE id = ?', id);
		}
		await this.#schedulePurge();
	}

	saveImage(thread: string, dataUrl: string) {
		this.#active(thread);
		return this.ctx.storage.transactionSync(() => this.#images.put(thread, dataUrl));
	}

	image(id: string) {
		return this.#images.get(id);
	}

	threads(): ThreadSummary[] {
		return this.#sql
			.exec<ThreadRow>(`${selectThreads} WHERE t.deleted_at IS NULL ORDER BY t.updated_at DESC`)
			.toArray()
			.map(toSummary);
	}

	otherThreads(from: string) {
		return this.threads()
			.filter((thread) => thread.id !== from && thread.status !== 'discarded')
			.map(({ id, headline, status }) => ({ id, headline, status }));
	}

	async messageThread(from: string, to: string, text: string) {
		if (from === to) throw new Error('That is this thread');
		const sender = this.#active(from);
		const recipient = this.#summary(to);
		if (!recipient || recipient.deleted) throw new Error(`There is no thread ${to}`);
		const steering = ['running', 'shipping'].includes(recipient.status);
		if (!steering && recipient.status !== 'draft') {
			throw new Error(
				`Thread ${to} is ${recipient.status} and waiting for a person. Tell your person instead.`
			);
		}
		if (this.#threadMessagesSincePerson(to) >= maxThreadMessages) {
			throw new Error(
				`Thread ${to} has had ${maxThreadMessages} thread messages since a person last wrote there. Ask your person before sending more.`
			);
		}
		this.#add(from, {
			type: 'thread-message',
			direction: 'out',
			thread: to,
			headline: recipient.headline,
			text
		});
		const entry = this.#add(to, {
			type: 'thread-message',
			direction: 'in',
			thread: from,
			headline: sender.headline,
			text,
			...(steering && { steering: { read: false } })
		});
		const author = {
			name: `Thread ${from} (${sender.headline || 'New thread'})`,
			kind: 'agent' as const
		};
		await this.#converse(to, author, text, entry);
		return steering
			? 'Delivered. Its agent reads it at its next step.'
			: 'Delivered. Its agent will reply in this thread.';
	}

	async threadDigest(id: string) {
		const summary = this.#summary(id);
		if (!summary || summary.deleted) return `There is no thread ${id}`;
		const entries = this.#entries(id);
		const history = historyLines(entries);
		const intent = entries.findLast((entry) => entry.type === 'intent');
		const files = await this.changes(id).catch(() => null);
		const running = this.#services(id).filter((service) => service.status === 'running');
		const lines = [`${id} · ${summary.status} · ${summary.headline || 'New thread'}`];
		if (intent?.type === 'intent') {
			lines.push(`Intent: ${intent.intent.purpose}`, 'Done when:');
			for (const check of intent.intent.doneWhen) lines.push(`- ${check}`);
		}
		if (summary.shipped) {
			lines.push(`Shipped in ${summary.shipped.sha.slice(0, 7)} by ${summary.shipped.by}`);
		}
		if (files?.length) {
			lines.push('Changed files:');
			for (const file of files) {
				lines.push(`- ${file.path} (${file.change}, +${file.additions} −${file.deletions})`);
			}
		}
		if (running.length)
			lines.push(`Running services: ${running.map((service) => service.name).join(', ')}`);
		const recent = history.slice(-recentHistory);
		lines.push(
			`Recent history (${recent.length} of ${history.length}; search_thread finds older entries):`,
			...recent
		);
		return lines.join('\n');
	}

	searchThread(id: string, query: string) {
		const summary = this.#summary(id);
		if (!summary || summary.deleted) return `There is no thread ${id}`;
		const history = historyLines(this.#entries(id));
		const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
		const hits = history.filter((line) => terms.every((term) => line.toLowerCase().includes(term)));
		if (!hits.length) return `No matches in ${history.length} entries.`;
		const shown = hits.slice(-maxSearchHits);
		const more = hits.length - shown.length;
		return [
			`${hits.length} matches in ${history.length} entries${more ? ` (showing the latest ${shown.length})` : ''}:`,
			...shown
		].join('\n');
	}

	async threadDiff(id: string, path?: string) {
		const summary = this.#summary(id);
		if (!summary || summary.deleted) return `There is no thread ${id}`;
		const files = ((await this.changes(id).catch(() => null)) ?? []).filter(
			(file) =>
				!path || file.path === path || file.oldPath === path || file.path.endsWith(`/${path}`)
		);
		if (!files.length) return path ? `No changes to ${path}.` : 'No changes.';
		const text = files.map(renderDiff).join('\n');
		return text.length > maxDiffChars ? `${text.slice(0, maxDiffChars)}\n… truncated` : text;
	}

	#threadMessagesSincePerson(thread: string) {
		const rows = this.#sql
			.exec<{ body: string }>('SELECT body FROM entries WHERE thread = ? ORDER BY seq DESC', thread)
			.toArray();
		let count = 0;
		for (const row of rows) {
			const entry = JSON.parse(row.body) as Entry;
			if (entry.type === 'message' && entry.author.kind === 'person') break;
			if (entry.type === 'thread-message' && entry.direction === 'in') count++;
		}
		return count;
	}

	thread(id: string): ThreadDetail | null {
		const summary = this.#summary(id);
		if (!summary) return null;
		if (summary.deleted) {
			return {
				summary,
				entries: [],
				usage: this.#usage(id, summary.mode, []),
				services: [],
				activity: null
			};
		}
		const rows = this.#sql
			.exec<{ body: string }>('SELECT body FROM entries WHERE thread = ? ORDER BY seq', id)
			.toArray();
		return {
			summary,
			entries: rows.map((row) => JSON.parse(row.body) as Entry),
			usage: this.#usage(id, summary.mode),
			services: this.#services(id),
			activity: this.#activities.get(id) ?? null,
			control: this.#acceptance.control(id)
		};
	}

	async intentProposed(thread: string, intent: Intent) {
		const summary = this.#summary(thread);
		if (!summary || summary.deleted) return;
		if (['discarded', 'shipping', 'shipped'].includes(summary.status)) return;
		const id = this.#add(thread, { type: 'intent', intent });
		this.#sql.exec('UPDATE threads SET headline = ? WHERE id = ?', intent.headline, thread);
		this.#touch(thread);
		const assessment = await this.#assess(describeIntent(intent), thread);
		if (!assessment) return;
		const { similar, size } = assessment;
		if (similar.length) this.#replace(thread, { ...this.#entry(thread, id)!, similar } as Entry);
		const current = this.#summary(thread)!;
		if (current.auto && current.status === 'draft' && current.mode !== size) {
			this.#sql.exec('UPDATE threads SET mode = ? WHERE id = ?', size, thread);
			this.#touch(thread);
		}
	}

	async assess(text: string) {
		return (await this.#assess(text)) ?? { similar: [], size: 'medium' as const };
	}

	async forwardIntent(thread: string, to: string, by: Author) {
		const intent = this.#entries(thread).findLast((entry) => entry.type === 'intent');
		if (intent?.type !== 'intent') throw new Error('This thread has no intent to share');
		return this.messageThread(
			thread,
			to,
			`${by.name} found that this thread has the same goal as yours: ${describeIntent(intent.intent)}`
		);
	}

	async #assess(text: string, exclude?: string): Promise<Assessment | null> {
		const candidates = this.threads()
			.filter((thread) => thread.id !== exclude && thread.headline)
			.slice(0, maxSimilarCandidates)
			.map((thread) => {
				const intent = this.#entries(thread.id).findLast((entry) => entry.type === 'intent');
				return {
					id: thread.id,
					headline: thread.headline,
					...(intent?.type === 'intent' && { purpose: intent.intent.purpose })
				};
			});
		try {
			return await Promise.race([
				assessRequest((request) => this.env.MODELS.decide(request), text, candidates),
				new Promise<never>((_, reject) =>
					setTimeout(() => reject(new Error('Assessing the request timed out')), similarTimeoutMs)
				)
			]);
		} catch (error) {
			console.warn('Could not assess the request', error);
			return null;
		}
	}

	#entries(thread: string) {
		return this.#sql
			.exec<{ body: string }>('SELECT body FROM entries WHERE thread = ? ORDER BY seq', thread)
			.toArray()
			.map((row) => JSON.parse(row.body) as Entry);
	}

	#replace(thread: string, entry: Entry) {
		this.#sql.exec(
			'UPDATE entries SET body = ? WHERE seq = ? AND thread = ?',
			JSON.stringify(entry),
			Number(entry.id.slice(1)),
			thread
		);
		this.#broadcast({ type: 'entry', thread, entry });
	}

	suggestThread(thread: string, { context, ...intent }: Suggestion) {
		const summary = this.#summary(thread);
		if (!summary || summary.deleted || summary.status === 'discarded') return;
		this.#add(thread, { type: 'suggestion', intent, context, outcome: null });
	}

	async spinOff(thread: string, entry: string, by: Author) {
		const parent = this.#active(thread);
		const suggestion = this.#entry(thread, entry);
		if (suggestion?.type !== 'suggestion' || suggestion.outcome) {
			throw new Error('That suggestion is no longer open');
		}
		const id = crypto.randomUUID().replaceAll('-', '').slice(0, 12);
		this.#sql.exec(
			`INSERT INTO threads (id, headline, status, mode, machine, parent, context, updated_at)
			VALUES (?, ?, 'draft', ?, ?, ?, ?, ?)`,
			id,
			suggestion.intent.headline,
			parent.mode,
			parent.machine,
			thread,
			suggestion.context,
			Date.now()
		);
		if (suggestion.context)
			this.#add(id, { type: 'message', author: agent, text: suggestion.context });
		this.#add(id, { type: 'intent', intent: suggestion.intent });
		this.#update(thread, { ...suggestion, outcome: { kind: 'spun-off', thread: id, by: by.name } });
		return this.#summary(id)!;
	}

	dismissSuggestion(thread: string, entry: string, by: Author) {
		this.#active(thread);
		const suggestion = this.#entry(thread, entry);
		if (suggestion?.type !== 'suggestion' || suggestion.outcome) return;
		this.#update(thread, { ...suggestion, outcome: { kind: 'dismissed', by: by.name } });
	}

	async serviceAction(thread: string, action: 'start' | 'stop' | 'restart', name: string) {
		this.#active(thread);
		await this.#executor(thread).serviceAction(action, name);
	}

	serviceLogs(thread: string, name: string) {
		this.#active(thread);
		return this.#executor(thread).serviceLogs(name) as Promise<string>;
	}

	changes(thread: string) {
		this.#active(thread);
		return this.#executor(thread).changes() as Promise<DiffFile[] | null>;
	}

	async ship(thread: string, { by, email, title, body }: ShipInput) {
		const summary = this.#active(thread);
		if (summary.status !== 'needs-you' || !summary.changes) {
			throw new Error('This thread has nothing ready to ship');
		}
		await this.#owner(by);
		const run = this.#acceptance.run(thread);
		const revision = await this.#executor(thread).revision();
		if (this.#active(thread).status !== 'needs-you')
			throw new Error('The proposal is no longer ready');
		if (!run || this.#acceptance.run(thread)?.id !== run.id || !revision)
			throw new Error('There is no stable revision; start a new run');
		const accepted = this.#acceptance.intent(thread);
		if (!accepted || revision.intent !== accepted.id)
			throw new Error('This revision implements an older intent');
		this.#requireDependencies(thread);
		if (
			this.#acceptance
				.promotions()
				.some(
					(p) => p.proposal === thread && !['failed', 'cancelled', 'shipped'].includes(p.status)
				)
		)
			throw new Error('This proposal already has a pending candidate');
		this.#acceptance.putRevision(revision);
		this.#acceptance.putPromotion({
			id: crypto.randomUUID().replaceAll('-', ''),
			proposal: thread,
			revision: revision.id,
			intent: accepted.id,
			requestedBy: by,
			approvedBy: null,
			email,
			title,
			body,
			status: 'queued',
			candidate: null,
			error: null,
			notesPublished: false,
			at: Date.now()
		});
		this.#setStatus(thread, 'shipping');
		this.#add(thread, {
			type: 'event',
			text: 'Preparing an isolated integration candidate. Exact approval is required before publication.'
		});
		await this.#schedulePurge();
	}

	async approvePromotion(thread: string, id: string, by: Author) {
		await this.#owner(by);
		this.#active(thread);
		const control = this.#acceptance.control(thread);
		const promotion = control.promotions.find((p) => p.id === id);
		if (!promotion || promotion.status !== 'ready')
			throw new Error('This candidate is not awaiting approval');
		const problem = promotionProblem(
			promotion,
			control.acceptedIntent,
			control.revisions.find((r) => r.id === promotion.revision)
		);
		if (problem) throw new Error(problem);
		this.#requireDependencies(thread);
		if (this.#acceptance.promotions().some((p) => p.status === 'publishing'))
			throw new Error('Another publication is being reconciled. Try again when it completes.');
		this.#acceptance.putPromotion({ ...promotion, status: 'publishing', approvedBy: by });
		this.#setStatus(thread, 'shipping');
		this.#add(thread, {
			type: 'event',
			text: `${by.name} approved exact candidate ${promotion.candidate!.sha.slice(0, 7)}`
		});
		await this.#schedulePurge();
	}

	async #owner(by: Author) {
		if (by.kind !== 'person' || !(await canAccessRepository(db, this.#repo(), by.id, 'owner')))
			throw new Error('Repository owner permission is required');
	}

	#executor(thread: string) {
		return this.env.ATTEMPTS.getByName(this.#acceptance.run(thread)?.id ?? thread);
	}

	#cancelPromotions(thread: string) {
		const pending = this.#acceptance.control(thread).promotions;
		if (pending.some((p) => p.status === 'publishing'))
			throw new Error(
				'Publication has been admitted; its outcome must be reconciled before cancellation'
			);
		for (const p of pending.filter((p) => ['queued', 'preparing', 'ready'].includes(p.status)))
			this.#acceptance.putPromotion({
				...p,
				status: 'cancelled',
				error: 'Cancelled before publication'
			});
	}

	async #advancePromotion() {
		const all = this.#acceptance.promotions();
		const p =
			all.find((p) => p.status === 'publishing') ??
			all.find((p) => ['queued', 'preparing'].includes(p.status)) ??
			all.find((p) => p.status === 'shipped' && !p.notesPublished);
		if (!p) return;
		const repo = this.#repo();
		const publisher = this.env.REPOSITORY_GIT.getByName(`promotion-${p.id}`);
		const control = this.#acceptance.control(p.proposal);
		const revision = control.revisions.find((r) => r.id === p.revision);
		const current = () => this.#acceptance.promotions().find((item) => item.id === p.id)!;
		try {
			if (p.status === 'shipped') {
				await publisher.notes(
					repo,
					p.candidate!,
					JSON.stringify({
						schema: 1,
						promotion: p.id,
						source: revision,
						intent: this.#acceptance.acceptedIntent(p.intent),
						authorizedBy: p.approvedBy
					})
				);
				this.#acceptance.putPromotion({ ...p, notesPublished: true, error: null });
				return;
			}
			if (p.status === 'publishing') {
				// Authorization was fixed at admission. A lost response retries the same ref update.
				await publisher.promote(repo, p.candidate!);
				this.#acceptance.putPromotion({ ...p, status: 'shipped', error: null });
				this.#sql.exec(
					'UPDATE threads SET shipped_sha = ?, shipped_at = ?, shipped_by = ? WHERE id = ?',
					p.candidate!.sha,
					Date.now(),
					p.approvedBy!.name,
					p.proposal
				);
				this.#setStatus(p.proposal, 'shipped');
				this.#add(p.proposal, {
					type: 'event',
					text: `Promoted ${p.candidate!.sha.slice(0, 7)} to ${p.candidate!.branch}. Outcome confirmation remains a human decision.`
				});
				this.#invalidateDependencies(p.proposal);
				return;
			}
			if (!revision || !control.acceptedIntent || control.acceptedIntent.id !== p.intent)
				throw new Error('The accepted intent or source revision changed');
			const requiredCommits = this.#requireDependencies(p.proposal);
			this.#acceptance.putPromotion({ ...p, status: 'preparing' });
			const candidate = await publisher.prepare(repo, revision, p, requiredCommits);
			if (current().status === 'cancelled') return;
			this.#acceptance.putPromotion({ ...p, candidate, status: 'ready', error: null });
			this.#setStatus(p.proposal, 'needs-you');
			this.#add(p.proposal, {
				type: 'event',
				text: `Candidate ${candidate.sha.slice(0, 7)} is ready for approval`
			});
		} catch (error) {
			if (current().status === 'cancelled') return;
			const message = error instanceof Error ? error.message : String(error);
			const uncertain = p.status === 'publishing' && !message.includes('Stale candidate:');
			this.#acceptance.putPromotion({
				...current(),
				status: p.status === 'shipped' ? 'shipped' : uncertain ? 'publishing' : 'failed',
				error: message
			});
			if (!uncertain && p.status !== 'shipped') {
				this.#setStatus(p.proposal, 'needs-you');
				this.#add(p.proposal, { type: 'event', text: `Integration stopped: ${message}` });
			}
		} finally {
			if (this.#summary(p.proposal)) this.#touch(p.proposal);
		}
	}

	attemptUpdated(thread: string, update: AttemptUpdate, runId?: string) {
		const summary = this.#summary(thread);
		if (!summary) return;
		const run = this.#acceptance.run(thread);
		const discussion = runId === `discussion-${thread}`;
		if (discussion) {
			if (!['reply', 'read', 'usage', 'activity', 'conversation-failed'].includes(update.type))
				return;
		} else if (run && (runId !== run.id || summary.status === 'shipped')) return;
		if (!discussion && run && update.type === 'status')
			this.#acceptance.putRun({ ...run, status: update.status });
		if (summary.status === 'shipping' && !['usage', 'read'].includes(update.type)) return;
		if (update.type === 'changes') {
			this.#sql.exec(
				'UPDATE threads SET changes = ? WHERE id = ?',
				JSON.stringify(update.summary),
				thread
			);
			this.#touch(thread);
			return;
		}
		if (update.type === 'usage') {
			for (const usage of update.usage) this.#recordUsage(thread, update.task, update.model, usage);
			return;
		}
		if (update.type === 'services') {
			this.#sql.exec(
				'UPDATE threads SET services = ?, preview = ? WHERE id = ?',
				JSON.stringify(update.services),
				update.preview,
				thread
			);
			this.#touch(thread);
			return;
		}
		if (update.type === 'read') {
			for (const id of update.entries) this.#markRead(thread, id);
			return;
		}
		if (update.type === 'activity') {
			this.#setActivity(thread, update.activity);
			return;
		}
		if (update.type === 'startup') {
			this.#add(thread, { type: 'startup', stages: update.stages });
			return;
		}
		if (update.type === 'conversation-failed') {
			this.#setActivity(thread, null);
			this.#add(thread, { type: 'event', text: `Couldn't reply: ${update.error}` });
			return;
		}
		if (update.type === 'step' || update.type === 'reply') {
			const task = update.type === 'reply' ? 'conversation' : 'attempt';
			if (update.step.usage) {
				this.#recordUsage(thread, task, modes[summary.mode].model, update.step.usage);
				this.#touch(thread);
			}
			for (const turn of update.step.turns) {
				if (turn.role === 'assistant' && turn.text.trim()) {
					this.#add(thread, { type: 'message', author: agent, text: turn.text.trim() });
				}
			}
			if (update.tools?.length) this.#add(thread, { type: 'tools', calls: update.tools });
			const activity = this.#activities.get(thread);
			if (activity) this.#setActivity(thread, { ...activity, text: '', calls: [] });
			if (update.type === 'step' && update.step.checkpoint) {
				this.#add(thread, {
					type: 'event',
					text: `Checkpoint ${update.step.checkpoint.slice(0, 7)}`
				});
			}
			return;
		}

		const outcomes: Partial<Record<AttemptStatus, [ThreadStatus, string]>> = {
			finished: ['needs-you', 'The attempt finished'],
			stopped: ['needs-you', 'The attempt stopped at its step limit'],
			failed: ['needs-you', `The attempt failed: ${update.error}`],
			cancelled: ['discarded', 'The attempt was cancelled']
		};
		const outcome = outcomes[update.status];
		if (!outcome) return;
		this.#setActivity(thread, null);
		this.#add(thread, { type: 'event', text: outcome[1] });
		this.#setStatus(thread, outcome[0]);
	}

	override async fetch(request: Request) {
		if (request.headers.get('Upgrade') !== 'websocket')
			return new Response('Expected a WebSocket', { status: 426 });
		const [client, server] = Object.values(new WebSocketPair());
		this.ctx.acceptWebSocket(server!);
		return new Response(null, { status: 101, webSocket: client });
	}

	async #converse(thread: string, author: Author, text: string, entry: string) {
		await this.#dispatchRuns();
		const { mode, machine, status } = this.#summary(thread)!;
		const run = this.#acceptance.run(thread);
		const intentVersion = this.#acceptance.intent(thread)?.id;
		const discussion = run && (status === 'shipped' || run.intent !== intentVersion);
		const [row] = this.#sql
			.exec<Pick<ThreadRow, 'context'>>('SELECT context FROM threads WHERE id = ?', thread)
			.toArray();
		const executor = discussion
			? this.env.ATTEMPTS.getByName(`discussion-${thread}`)
			: this.#executor(thread);
		await executor.converse({
			proposal: thread,
			intentVersion,
			repo: this.#repo(),
			mode,
			machine,
			context: discussion
				? describeTask(this.#acceptance.intent(thread)!.intent, this.#conversation(thread))
				: (row?.context ?? undefined),
			author: author.name,
			text,
			entry
		});
	}

	#services(thread: string): ThreadService[] {
		const [row] = this.#sql
			.exec<Pick<ThreadRow, 'services' | 'preview'>>(
				'SELECT services, preview FROM threads WHERE id = ?',
				thread
			)
			.toArray();
		if (!row?.services) return [];
		return (JSON.parse(row.services) as ServiceInfo[]).map(
			({ name, command, port, saved, status, exitCode }) => ({
				name,
				command,
				port,
				saved,
				status,
				exitCode,
				preview: row.preview ? `https://${row.preview.replace('{name}', name)}` : ''
			})
		);
	}

	#entry(thread: string, id: string) {
		const [row] = this.#sql
			.exec<{ body: string }>(
				'SELECT body FROM entries WHERE seq = ? AND thread = ?',
				Number(id.slice(1)),
				thread
			)
			.toArray();
		return row ? (JSON.parse(row.body) as Entry) : undefined;
	}

	#update(thread: string, entry: Entry) {
		this.#sql.exec(
			'UPDATE entries SET body = ? WHERE seq = ?',
			JSON.stringify(entry),
			Number(entry.id.slice(1))
		);
		this.#broadcast({ type: 'entry', thread, entry });
		this.#touch(thread);
	}

	#markRead(thread: string, id: string) {
		const seq = Number(id.slice(1));
		const [row] = this.#sql
			.exec<{ body: string }>('SELECT body FROM entries WHERE seq = ? AND thread = ?', seq, thread)
			.toArray();
		if (!row) return;
		const entry = JSON.parse(row.body) as Entry;
		if (entry.type !== 'message' && entry.type !== 'thread-message') return;
		if (!entry.steering || entry.steering.read) return;
		const read = { ...entry, steering: { read: true } };
		this.#sql.exec('UPDATE entries SET body = ? WHERE seq = ?', JSON.stringify(read), seq);
		this.#broadcast({ type: 'entry', thread, entry: read });
	}

	#setActivity(thread: string, activity: ThreadActivity | null) {
		const idle =
			!activity ||
			(!activity.startup && !activity.status && !activity.text && !activity.calls.length);
		if (idle && !this.#activities.has(thread)) return;
		if (idle) this.#activities.delete(thread);
		else this.#activities.set(thread, activity);
		this.#broadcast({ type: 'activity', thread, activity: idle ? null : activity });
	}

	#add(thread: string, entry: DistributiveOmit<Entry, 'id' | 'at'>) {
		const at = Date.now();
		const { seq } = this.#sql
			.exec<{ seq: number }>(
				`INSERT INTO entries (thread, body) VALUES (?, '') RETURNING seq`,
				thread
			)
			.one();
		const full = { ...entry, id: `e${seq}`, at } as Entry;
		this.#sql.exec('UPDATE entries SET body = ? WHERE seq = ?', JSON.stringify(full), seq);
		this.#broadcast({ type: 'entry', thread, entry: full });
		this.#touch(thread);
		return full.id;
	}

	#recordUsage(thread: string, task: UsageRow['task'], model: string, usage: Usage) {
		this.#sql.exec(
			`INSERT INTO usage (thread, task, model, input_tokens, cached_input_tokens, cache_write_tokens, output_tokens, at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			thread,
			task,
			model,
			usage.inputTokens,
			usage.cachedInputTokens,
			usage.cacheWriteTokens,
			usage.outputTokens,
			Date.now()
		);
	}

	#usage(thread: string, mode: Mode, calls = this.#calls(thread)): ThreadUsage {
		const rows = new Map<string, UsageRow>();
		for (const call of calls) {
			const price = cost(call.model, {
				inputTokens: call.input_tokens,
				cachedInputTokens: call.cached_input_tokens,
				cacheWriteTokens: call.cache_write_tokens,
				outputTokens: call.output_tokens
			});
			const key = `${call.task} ${call.model}`;
			const row = rows.get(key) ?? { task: call.task, model: call.model, tokens: 0, cost: 0 };
			row.tokens += call.input_tokens + call.output_tokens;
			row.cost = row.cost === null || price === null ? null : row.cost + price;
			rows.set(key, row);
		}
		const latest =
			calls.findLast((call) => call.task === 'attempt') ??
			calls.findLast((call) => call.task === 'conversation') ??
			calls.at(-1);
		const model = latest?.model ?? modes[mode].model;
		return {
			rows: [...rows.values()],
			context: {
				used: latest ? latest.input_tokens + latest.output_tokens : 0,
				limit: models[model]?.contextWindow ?? 0
			}
		};
	}

	#calls(thread: string) {
		return this.#sql
			.exec<{
				task: UsageRow['task'];
				model: string;
				input_tokens: number;
				cached_input_tokens: number;
				cache_write_tokens: number;
				output_tokens: number;
			}>('SELECT * FROM usage WHERE thread = ? ORDER BY seq', thread)
			.toArray();
	}

	#setStatus(thread: string, status: ThreadStatus) {
		this.#sql.exec('UPDATE threads SET status = ? WHERE id = ?', status, thread);
		this.#touch(thread);
	}

	#touch(thread: string) {
		this.#sql.exec('UPDATE threads SET updated_at = ? WHERE id = ?', Date.now(), thread);
		this.#broadcast({ type: 'thread', summary: this.#summary(thread)! });
	}

	#broadcast(message: LiveMessage) {
		const data = JSON.stringify(message);
		for (const socket of this.ctx.getWebSockets()) {
			try {
				socket.send(data);
			} catch {}
		}
	}

	#summary(id: string) {
		const row = this.#sql.exec<ThreadRow>(`${selectThreads} WHERE t.id = ?`, id).toArray()[0];
		return row && toSummary(row);
	}

	#require(id: string) {
		const summary = this.#summary(id);
		if (!summary) throw new Error(`There is no thread ${id}`);
		return summary;
	}

	#repo() {
		const [row] = this.#sql
			.exec<{ value: string }>("SELECT value FROM meta WHERE key = 'repo'")
			.toArray();
		const repo = row?.value ?? this.ctx.id.name;
		if (!repo) throw new Error("This coordinator doesn't know its repository yet");
		return repo;
	}

	#active(id: string) {
		const summary = this.#require(id);
		if (summary.deleted) throw new Error(`Thread ${id} was deleted`);
		return summary;
	}

	async #schedulePurge() {
		const [next] = this.#sql
			.exec<{ at: number | null }>(
				'SELECT MIN(deleted_at) AS at FROM threads WHERE deleted_at IS NOT NULL'
			)
			.toArray();
		const pending = this.#acceptance
			.promotions()
			.some(
				(p) =>
					['queued', 'preparing', 'publishing'].includes(p.status) ||
					(p.status === 'shipped' && !p.notesPublished)
			);
		if (pending || this.#sql.exec('SELECT 1 FROM run_dispatch LIMIT 1').toArray().length)
			await this.ctx.storage.setAlarm(Date.now() + 1000);
		else if (next?.at) await this.ctx.storage.setAlarm(next.at + threadPurgeDelayMs);
		else await this.ctx.storage.deleteAlarm();
	}

	#latestIntent(thread: string) {
		return this.thread(thread)
			?.entries.filter((entry) => entry.type === 'intent')
			.at(-1)?.intent;
	}

	#conversation(thread: string) {
		return (this.thread(thread)?.entries ?? []).flatMap((entry) =>
			entry.type === 'message' ? [{ author: entry.author.name, text: entry.text }] : []
		);
	}
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

const selectThreads =
	'SELECT t.*, p.headline AS parent_headline FROM threads t LEFT JOIN threads p ON p.id = t.parent';

function headlineFrom(text: string) {
	const line = text.trim().split('\n')[0]!.trim();
	return line.length > 72 ? `${line.slice(0, 71)}…` : line;
}

function toSummary(row: ThreadRow): ThreadSummary {
	return {
		id: row.id,
		headline: row.headline,
		status: row.status,
		mode: row.mode,
		auto: row.auto === 1,
		machine: row.machine ?? defaultMachine,
		updatedAt: row.updated_at,
		deleted: row.deleted_at === null ? null : { at: row.deleted_at, by: row.deleted_by ?? '' },
		parent: row.parent ? { id: row.parent, headline: row.parent_headline ?? '' } : null,
		changes: row.changes ? (JSON.parse(row.changes) as DiffSummary) : null,
		shipped:
			row.shipped_sha && row.shipped_at
				? { sha: row.shipped_sha, by: row.shipped_by ?? '', at: row.shipped_at }
				: null
	};
}
