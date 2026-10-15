import { expect, test } from 'vitest';
import { setup, untilThread } from './support.ts';

const { worker, script, modelRequests, scriptDecisions, decisionRequests, seed } = await setup();

test('suggests separate work and spins it off into a linked thread that starts working', async () => {
	await seed('suggesting', { 'notes.md': 'Some notes\n' });
	const suggestion = {
		headline: 'fix(audit): query only the last entry',
		purpose: 'Settings fetch the whole audit log.',
		doneWhen: ['One query returns one row'],
		context: 'notes.md:1 mentions the audit log query.'
	};
	await script('suggesting', [
		[
			{
				type: 'response.output_item.done',
				item: {
					type: 'function_call',
					call_id: 'suggest',
					name: 'launch_thread',
					arguments: JSON.stringify({ ...suggestion, start: false })
				}
			}
		],
		[{ type: 'response.output_text.delta', delta: 'Noted that separately.' }],
		[{ type: 'response.output_text.delta', delta: 'Got it.' }]
	]);
	const env = await worker.getEnv();
	const repo = env.REPOS.getByName('suggesting');
	const sam = { name: 'Sam', kind: 'person' as const };
	const { id } = await repo.openThread({
		repo: 'suggesting',
		author: sam,
		text: 'Tidy the notes.',
		mode: 'small',
		machine: 'standard-1'
	});
	const parent = await untilThread(repo, id, (detail) =>
		detail.entries.some(
			(entry) => entry.type === 'message' && entry.text === 'Noted that separately.'
		)
	);
	const card = parent.entries.find((entry) => entry.type === 'suggestion')!;
	expect(card).toMatchObject({
		intent: { headline: suggestion.headline, doneWhen: suggestion.doneWhen },
		context: suggestion.context,
		outcome: null
	});

	const child = await repo.spinOff(id, card.id, sam);
	expect(child).toMatchObject({
		headline: suggestion.headline,
		number: 2,
		status: 'working',
		mode: 'small',
		parent: { id, number: 1, headline: 'Tidy the notes.' }
	});
	expect((await repo.thread(id))!.entries.find((entry) => entry.id === card.id)).toMatchObject({
		outcome: { kind: 'spun-off', thread: child.id, number: 2, by: 'Sam' }
	});
	await expect(repo.spinOff(id, card.id, sam)).rejects.toThrow();
	const sql = await worker.getDurableObjectStorage('REPOS', { name: 'suggesting' });
	await sql.exec(
		"UPDATE entries SET body = json_remove(body, '$.outcome.number') WHERE thread = ?",
		id
	);
	expect((await repo.thread(id))!.entries.find((entry) => entry.id === card.id)).toMatchObject({
		outcome: { thread: child.id, number: 2 }
	});

	const started = await untilThread(repo, child.id, (detail) =>
		detail.entries.some((entry) => entry.type === 'message' && entry.text === 'Got it.')
	);
	expect(
		started.entries.filter((entry) => ['message', 'intent', 'event'].includes(entry.type))
	).toMatchObject([
		{ type: 'message', author: { name: 'ReGit' }, text: suggestion.context },
		{ type: 'intent', intent: { headline: suggestion.headline } },
		{ type: 'event', text: 'Started by Sam' },
		{ type: 'message', author: { kind: 'agent' }, text: 'Got it.' }
	]);
	expect(await repo.children(id)).toMatchObject([
		{
			summary: { id: child.id, number: 2, parent: { id } },
			doneWhen: { met: 0, total: suggestion.doneWhen.length },
			previews: []
		}
	]);
	expect(await repo.children(child.id)).toEqual([]);
	await repo.doneWhenRecorded(child.id, [{ check: 1, status: 'met', evidence: 'test' }], 'tree');
	await repo.attemptUpdated(child.id, {
		type: 'services',
		preview: `${child.id}-{name}.regit.run`,
		services: [
			{ name: 'web', command: 'bun dev', port: 5173, saved: true, status: 'running' },
			{ name: 'docs', command: 'bun docs', port: 4000, saved: true, status: 'stopped' }
		]
	});
	expect(await repo.children(id)).toMatchObject([
		{
			doneWhen: { met: 1, total: 1 },
			previews: [{ name: 'web', url: `https://${child.id}-web.regit.run` }]
		}
	]);
	const query = JSON.stringify((await modelRequests('suggesting')).at(-1)!.query);
	expect(query).toContain('spun off from another one');
	expect(query).toContain(suggestion.context);
	expect(query).toContain(`Sam: Work on this thread's intent.`);
	expect(query).toContain(suggestion.doneWhen[0]);

	await repo.launchThread(id, { ...suggestion, headline: 'docs: explain the audit log' }, false);
	const second = (await repo.thread(id))!.entries.findLast((entry) => entry.type === 'suggestion')!;
	repo.dismissSuggestion(id, second.id, sam);
	await untilThread(repo, id, (detail) =>
		detail.entries.some(
			(entry) =>
				entry.id === second.id && entry.type === 'suggestion' && entry.outcome?.kind === 'dismissed'
		)
	);
});

test('starts a thread when a person asks for one', async () => {
	await seed('launching', { 'notes.md': 'Some notes\n' });
	const launch = {
		headline: 'docs(notes): add a table of contents',
		purpose: 'The notes are hard to scan.',
		doneWhen: ['notes.md starts with a table of contents'],
		context: 'Sam asked for this as its own thread.',
		start: true
	};
	await script('launching', [
		[
			{
				type: 'response.output_item.done',
				item: {
					type: 'function_call',
					call_id: 'launch',
					name: 'launch_thread',
					arguments: JSON.stringify(launch)
				}
			}
		],
		[{ type: 'response.output_text.delta', delta: 'On it.' }],
		[{ type: 'response.output_text.delta', delta: 'On it.' }]
	]);
	const env = await worker.getEnv();
	const repo = env.REPOS.getByName('launching');
	const sam = { name: 'Sam', kind: 'person' as const };
	const { id } = await repo.openThread({
		repo: 'launching',
		author: sam,
		text: 'Start a thread that adds a table of contents to the notes.',
		mode: 'small',
		machine: 'standard-1'
	});
	const parent = await untilThread(repo, id, (detail) =>
		detail.entries.some((entry) => entry.type === 'message' && entry.text === 'On it.')
	);
	const card = parent.entries.find((entry) => entry.type === 'suggestion')!;
	expect(card).toMatchObject({ outcome: { kind: 'spun-off', by: 'Sam' } });
	const child = (card as { outcome: { thread: string } }).outcome.thread;
	expect(parent.entries.find((entry) => entry.type === 'tools')).toMatchObject({
		calls: [{ tool: 'launch_thread', target: launch.headline, status: 'done' }]
	});

	const started = await untilThread(repo, child, (detail) =>
		detail.entries.some((entry) => entry.type === 'message' && entry.text === 'On it.')
	);
	expect(started.summary.parent).toEqual({ id, number: 1, headline: parent.summary.headline });
	expect(started.entries).toContainEqual(
		expect.objectContaining({ type: 'event', text: 'Started by Sam' })
	);
});

test("delivers a thread's message to another thread's agent", async () => {
	await seed('pair', { 'notes.md': 'Some notes\n' });
	const env = await worker.getEnv();
	const repo = env.REPOS.getByName('pair');
	const sam = { name: 'Sam', kind: 'person' as const };
	const replied = async (thread: string, count: number) => {
		await expect
			.poll(
				async () =>
					(await repo.thread(thread))!.entries.filter(
						(entry) => entry.type === 'message' && entry.author.kind === 'agent'
					).length,
				{ timeout: 20_000 }
			)
			.toBe(count);
	};

	await script('pair', [[{ type: 'response.output_text.delta', delta: 'Listening.' }]]);
	const ui = await repo.openThread({
		repo: 'pair',
		author: sam,
		text: 'Rework the settings page.',
		mode: 'small',
		machine: 'standard-1'
	});
	await replied(ui.id, 1);

	await script('pair', [
		[
			{
				type: 'response.output_item.done',
				item: {
					type: 'function_call',
					call_id: 'tell',
					name: 'message_thread',
					arguments: JSON.stringify({ thread: ui.id, text: 'User.id is now User.accountId.' })
				}
			}
		],
		[{ type: 'response.output_text.delta', delta: 'Noted.' }],
		[{ type: 'response.output_text.delta', delta: 'Noted.' }]
	]);
	const api = await repo.openThread({
		repo: 'pair',
		author: sam,
		text: 'Rename the user id and tell the settings thread.',
		mode: 'small',
		machine: 'standard-1'
	});
	await replied(api.id, 1);
	await replied(ui.id, 2);

	expect((await repo.thread(api.id))!.entries).toContainEqual(
		expect.objectContaining({
			type: 'thread-message',
			direction: 'out',
			thread: ui.id,
			text: 'User.id is now User.accountId.'
		})
	);
	expect((await repo.thread(ui.id))!.entries).toContainEqual(
		expect.objectContaining({
			type: 'thread-message',
			direction: 'in',
			thread: api.id,
			headline: 'Rename the user id and tell the settings thread.',
			text: 'User.id is now User.accountId.'
		})
	);
	const delivered = (await modelRequests('pair')).filter(
		(request) => (request.headers['cf-aig-metadata'] as { thread: string }).thread === ui.id
	);
	expect(JSON.stringify(delivered)).toContain(`Thread #${api.number} (`);
	const sql = await worker.getDurableObjectStorage('REPOS', { name: 'pair' });
	await sql.exec("UPDATE entries SET body = json_remove(body, '$.number') WHERE thread = ?", ui.id);
	expect((await repo.thread(ui.id))!.entries).toContainEqual(
		expect.objectContaining({
			type: 'thread-message',
			thread: api.id,
			number: api.number
		})
	);
});

test('refuses thread messages to itself, unknown or idle threads, and past the limit', async () => {
	await seed('guarded', { 'notes.md': 'Some notes\n' });
	const env = await worker.getEnv();
	const repo = env.REPOS.getByName('guarded');
	const sam = { name: 'Sam', kind: 'person' as const };
	await script(
		'guarded',
		Array.from({ length: 8 }, () => [{ type: 'response.output_text.delta', delta: 'Ok.' }])
	);
	const open = (text: string) =>
		repo.openThread({ repo: 'guarded', author: sam, text, mode: 'small', machine: 'standard-1' });
	const [from, to, idle] = [await open('One.'), await open('Two.'), await open('Three.')];
	// Miniflare's test bridge drops the message of a rejected RPC call, so only the rejection is checked.
	const send = async (a: string, b: string, text: string) => repo.messageThread(a, b, text);

	await expect(send(from.id, from.id, 'Hi')).rejects.toThrow();
	await expect(send(from.id, 'nope', 'Hi')).rejects.toThrow();
	await repo.archive(idle.id, sam);
	await expect(send(from.id, idle.id, 'Hi')).rejects.toThrow();
	for (let i = 0; i < 5; i++) await send(from.id, to.id, `Message ${i}`);
	await expect(send(from.id, to.id, 'One more')).rejects.toThrow();
	await repo.reply(to.id, { author: sam, text: 'Carry on.' });
	await expect(send(from.id, to.id, 'After the person')).resolves.toContain('Delivered');
});

test('exempts messages between a parent and its children from the limit', async () => {
	await seed('family', { 'notes.md': 'Some notes\n' });
	const env = await worker.getEnv();
	const repo = env.REPOS.getByName('family');
	const sam = { name: 'Sam', kind: 'person' as const };
	await script(
		'family',
		Array.from({ length: 40 }, () => [{ type: 'response.output_text.delta', delta: 'Ok.' }])
	);
	const parent = await repo.openThread({
		repo: 'family',
		author: sam,
		text: 'Split the work.',
		mode: 'small',
		machine: 'standard-1'
	});
	const outsider = await repo.openThread({
		repo: 'family',
		author: sam,
		text: 'Something else.',
		mode: 'small',
		machine: 'standard-1'
	});
	const child = async (headline: string) => {
		await repo.launchThread(
			parent.id,
			{ headline, purpose: 'Part of the work.', doneWhen: ['Done'], context: '' },
			false
		);
		const card = (await repo.thread(parent.id))!.entries.findLast(
			(entry) => entry.type === 'suggestion'
		)!;
		return (await repo.spinOff(parent.id, card.id, sam)).id;
	};
	const [first, second] = [await child('feat: first part'), await child('feat: second part')];
	const send = async (a: string, b: string, text: string) => repo.messageThread(a, b, text);

	for (let i = 0; i < 6; i++) {
		await expect(send(parent.id, first, `Down ${i}`)).resolves.toContain('Delivered');
		await expect(send(first, parent.id, `Up ${i}`)).resolves.toContain('Delivered');
	}
	for (let i = 0; i < 5; i++) await send(outsider.id, first, `Aside ${i}`);
	await expect(send(outsider.id, first, 'One more')).rejects.toThrow();
	await expect(send(parent.id, first, 'Still fine')).resolves.toContain('Delivered');

	for (let i = 0; i < 5; i++) await send(first, second, `Sibling ${i}`);
	await expect(send(first, second, 'One more')).rejects.toThrow();
});

test('flags a proposed intent that duplicates another thread, and forwards it there', async () => {
	await seed('dupes', { 'notes.md': 'Some notes\n' });
	const env = await worker.getEnv();
	const repo = env.REPOS.getByName('dupes');
	const sam = { name: 'Sam', kind: 'person' as const };
	const propose = (headline: string) => [
		{
			type: 'response.output_item.done',
			item: {
				type: 'function_call',
				call_id: 'intent',
				name: 'update_intent',
				arguments: JSON.stringify({
					headline,
					purpose: 'Big orgs wait for every member to load.',
					doneWhen: ['Settings loads in under a second']
				})
			}
		}
	];
	const intent = async (thread: string) => {
		await expect
			.poll(
				async () =>
					(await repo.thread(thread))!.entries.findLast((entry) => entry.type === 'intent'),
				{
					timeout: 20_000
				}
			)
			.toBeDefined();
		return (await repo.thread(thread))!.entries.findLast((entry) => entry.type === 'intent')!;
	};

	await script('dupes', [
		propose('perf(settings): load org members in pages'),
		[{ type: 'response.output_text.delta', delta: 'Proposed.' }]
	]);
	const first = await repo.openThread({
		repo: 'dupes',
		author: sam,
		text: 'Settings are slow.',
		mode: 'small',
		machine: 'standard-1'
	});
	expect(await intent(first.id)).not.toHaveProperty('similar');
	await untilThread(repo, first.id, (detail) => detail.summary.status === 'idle');

	await scriptDecisions('dupes', [
		{
			answers: { t1: { probabilities: { same: 0.93, overlap: 0.05, related: 0.02, unrelated: 0 } } }
		}
	]);
	await script('dupes', [
		propose('fix(settings): page the member list'),
		[{ type: 'response.output_text.delta', delta: 'Proposed.' }]
	]);
	const second = await repo.openThread({
		repo: 'dupes',
		author: sam,
		text: 'Members take ages.',
		mode: 'small',
		machine: 'standard-1'
	});
	await expect
		.poll(
			async () =>
				(await intent(second.id)).type === 'intent' &&
				((await intent(second.id)) as { similar?: unknown }).similar,
			{
				timeout: 20_000
			}
		)
		.toEqual([{ thread: first.id, relation: 'same', probability: 0.93 }]);
	const [asked] = await decisionRequests('dupes');
	expect(asked!.state).toMatchObject({
		new_intent: expect.stringContaining('fix(settings): page the member list'),
		threads: {
			t1: 'perf(settings): load org members in pages — Big orgs wait for every member to load. Done when: Settings loads in under a second'
		}
	});
	await untilThread(repo, second.id, (detail) => detail.summary.status === 'idle');

	await script('dupes', [[{ type: 'response.output_text.delta', delta: 'Thanks.' }]]);
	await repo.forwardIntent(second.id, first.id, sam);
	expect((await repo.thread(first.id))!.entries).toContainEqual(
		expect.objectContaining({
			type: 'thread-message',
			direction: 'in',
			thread: second.id,
			text: expect.stringContaining(
				'Sam found that this thread has the same goal as yours: fix(settings): page the member list'
			)
		})
	);

	await untilThread(repo, first.id, (detail) => detail.summary.status === 'idle');
	await repo.archive(first.id, sam);

	const weak = { probabilities: { same: 0.1, overlap: 0.6, related: 0.2, unrelated: 0.1 } };
	await scriptDecisions('dupes', [{ answers: { t1: weak, t2: weak } }]);
	expect(await repo.assess('Show members a page at a time')).toEqual({
		similar: [{ thread: second.id, relation: 'overlap', probability: 0.7 }],
		size: 'medium'
	});

	const strong = { probabilities: { same: 0.2, overlap: 0.7, related: 0.1, unrelated: 0 } };
	await scriptDecisions('dupes', [{ answers: { t1: strong, t2: strong } }]);
	expect((await repo.assess('Show members a page at a time')).similar).toEqual([
		{ thread: expect.any(String), relation: 'overlap', probability: 0.9 },
		{ thread: expect.any(String), relation: 'overlap', probability: 0.9 }
	]);
});

test('sizes an auto thread once, when it opens', async () => {
	await seed('sized', { 'notes.md': 'Some notes\n' });
	const env = await worker.getEnv();
	const repo = env.REPOS.getByName('sized');
	await scriptDecisions('sized', [
		{ answers: { size: { probabilities: { small: 0.1, medium: 0.2, large: 0.7 } } } },
		{ answers: { size: { probabilities: { small: 0.85, medium: 0.1, large: 0.05 } } } }
	]);
	await script('sized', [
		[
			{
				type: 'response.output_item.done',
				item: {
					type: 'function_call',
					call_id: 'intent',
					name: 'update_intent',
					arguments: JSON.stringify({
						headline: 'docs: fix a typo in the notes',
						purpose: 'The notes misspell "receive".',
						doneWhen: ['notes.md spells it correctly']
					})
				}
			}
		],
		[{ type: 'response.output_text.delta', delta: 'Proposed.' }]
	]);
	const opened = await repo.openThread({
		repo: 'sized',
		author: { name: 'Sam', kind: 'person' },
		text: 'Rework how notes are stored.',
		mode: 'auto',
		machine: 'standard-1'
	});
	expect(opened).toMatchObject({ mode: 'large', auto: true });
	await expect
		.poll(async () => (await repo.thread(opened.id))!.summary.status, { timeout: 20_000 })
		.toBe('idle');
	const [first, second] = await decisionRequests('sized');
	expect(first!.state).toMatchObject({ new_intent: 'Rework how notes are stored.' });
	expect(second!.state).toMatchObject({ new_intent: expect.stringContaining('typo') });

	// An intent that reads smaller doesn't move the thread to another model.
	const { summary, usage } = (await repo.thread(opened.id))!;
	expect(summary).toMatchObject({ mode: 'large', auto: true });
	const agent = usage.rows.filter((row) => row.task === 'agent');
	expect(agent).toEqual([expect.objectContaining({ model: 'gpt-6.1-sol', tokens: 120 })]);
});

test('answers questions about another thread without interrupting it', async () => {
	await seed('observed', { 'notes.md': 'Some notes\n' });
	const env = await worker.getEnv();
	const repo = env.REPOS.getByName('observed');
	const sam = { name: 'Sam', kind: 'person' as const };
	const callTool = (call_id: string, name: string, args: object) => [
		{
			type: 'response.output_item.done',
			item: { type: 'function_call', call_id, name, arguments: JSON.stringify(args) }
		}
	];
	const replied = async (thread: string) =>
		expect
			.poll(
				async () =>
					(await repo.thread(thread))!.entries.some(
						(entry) => entry.type === 'message' && entry.author.kind === 'agent'
					),
				{ timeout: 20_000 }
			)
			.toBe(true);

	await script('observed', [
		callTool('intent', 'update_intent', {
			headline: 'docs(notes): add a title',
			purpose: 'The notes have no heading.',
			doneWhen: ['notes.md starts with a title']
		}),
		[{ type: 'response.output_text.delta', delta: 'Proposed.' }]
	]);
	const target = await repo.openThread({
		repo: 'observed',
		author: sam,
		text: 'The notes need a title.',
		mode: 'small',
		machine: 'standard-1'
	});
	await replied(target.id);

	await script('observed', [
		callTool('ask', 'ask_threads', {
			question: 'What is the notes thread doing?',
			thread: target.id
		}),
		callTool('read', 'read_thread', { id: target.id }),
		[{ type: 'response.output_text.delta', delta: 'It is adding a title to notes.md.' }],
		[{ type: 'response.output_text.delta', delta: 'Done.' }]
	]);
	const watcher = await repo.openThread({
		repo: 'observed',
		author: sam,
		text: 'What are the others doing?',
		mode: 'small',
		machine: 'standard-1'
	});
	await replied(watcher.id);

	const detail = (await repo.thread(watcher.id))!;
	expect(detail.entries).toContainEqual(
		expect.objectContaining({
			type: 'tools',
			calls: [
				expect.objectContaining({
					tool: 'ask_threads',
					status: 'done',
					output: 'It is adding a title to notes.md.'
				})
			]
		})
	);
	expect(detail.usage.rows.map((row) => row.task)).toContain('search');
	const searches = (await modelRequests('observed')).filter(
		(request) => (request.headers['cf-aig-metadata'] as { task: string }).task === 'search'
	);
	expect(searches).toHaveLength(2);
	expect(JSON.stringify(searches[0]!.query)).toContain(
		`What is the notes thread doing? (thread ${target.id})`
	);
	expect(JSON.stringify(searches[1]!.query)).toContain('docs(notes): add a title');
	expect(JSON.stringify(searches[1]!.query)).toContain('notes.md starts with a title');
	expect(
		(await repo.thread(target.id))!.entries.some((entry) => entry.type === 'thread-message')
	).toBe(false);

	expect(await repo.searchThread(target.id, 'title')).toMatch(
		/^\d+ matches in \d+ entries:\n#\d+ of \d+: /
	);
	expect(await repo.threadDiff(target.id)).toBe('No changes.');
});
