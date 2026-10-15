import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { setup, untilMain, untilThread, writeNotes } from './support.ts';

const { dir, sh, commit, script, modelRequests, startedThread } = await setup();

const say = (delta: string) => [{ type: 'response.output_text.delta', delta }];

test('deploys green commits with the repository secrets, keeping them out of what it reports', async () => {
	const token = join(dir, 'deployed-token');
	const { repo, sam, id } = await startedThread(
		'deploying',
		[writeNotes('# Notes\\n'), say('Done.')],
		undefined,
		{
			'.agents/checks.yml': `checks:
  - name: title
    run: grep -q '^# ' notes.md
    before: [deploy]
`,
			'.agents/deploy': `printf '%s' "$API_TOKEN" > '${token}'\necho "deployed with $API_TOKEN"\n`
		}
	);
	await untilThread(repo, id, (detail) => detail.summary.status === 'idle');
	const lin = { id: 'lin', name: 'Lin', kind: 'person' as const };
	await expect(repo.setDeploySecret('API_TOKEN', 'x', lin)).rejects.toThrow();
	await expect(repo.setDeploySecret('api-token', 'x', sam)).rejects.toThrow();
	await expect(repo.setDeploySecret('API_TOKEN', '', sam)).rejects.toThrow();
	await repo.setDeploySecret('API_TOKEN', 'first-value', sam);
	await repo.setDeploySecret('API_TOKEN', 'sekrit-value', sam);
	await repo.setDeploySecret('UNUSED', 'other', sam);
	await repo.deleteDeploySecret('UNUSED', sam);
	expect(await repo.deploySecrets(sam)).toEqual([
		{ name: 'API_TOKEN', updatedAt: expect.any(Number), updatedBy: 'Sam' }
	]);
	await expect(repo.deploySecrets(lin)).rejects.toThrow();

	await repo.ship(id, { by: sam, email: 'sam@example.com', title: 'docs: add a title', body: '' });
	const canonical = join(dir, 'deploying.git');
	const deployed = await untilMain(repo, (main) => !!main.deployed);
	expect(deployed.deployed?.sha).toBe(sh(canonical, 'rev-parse', 'main'));
	expect(deployed.deployFailure).toBeNull();
	expect(await readFile(token, 'utf8')).toBe('sekrit-value');
	await untilThread(repo, id, (detail) => detail.summary.shipped?.verdict === 'deployed');
	const short = deployed.deployed!.sha.slice(0, 7);
	const notices = [
		`What this thread shipped as ${short} passed \`main\`'s deploy checks.`,
		`What this thread shipped as ${short} is deployed.`
	];
	for (const [text, reply] of [
		['Is it live?', 'Yes.'],
		['Anything else?', 'No.']
	]) {
		await script('deploying', [say(reply!)]);
		await repo.reply(id, { author: sam, text: text! });
		await untilThread(repo, id, (detail) =>
			detail.entries.some((entry) => entry.type === 'message' && entry.text === reply)
		);
		const query = JSON.stringify((await modelRequests('deploying')).at(-1)!.query);
		for (const notice of notices) expect(query.split(notice)).toHaveLength(2);
	}

	const work = join(dir, 'deploying-work');
	sh(work, 'pull', '--quiet', canonical, 'main');
	await commit(
		work,
		{ '.agents/deploy': 'echo "leaking $API_TOKEN after $REGIT_DEPLOYED_SHA"; exit 3\n' },
		'Break the deploy'
	);
	sh(work, 'push', '--quiet', canonical, 'main');
	const broken = sh(canonical, 'rev-parse', 'main');
	await repo.landed({ repo: 'deploying', ref: 'refs/heads/main', after: broken, headline: '' });
	const failed = await untilMain(repo, (main) => main.deployFailure?.sha === broken);
	expect(failed.deployFailure?.output).toBe(
		`exit code 3\nleaking [secret] after ${deployed.deployed?.sha}`
	);
	expect(failed.deployed?.sha).toBe(deployed.deployed?.sha);
	expect(failed.green?.sha).toBe(broken);
	expect(JSON.stringify(await repo.main())).not.toContain('sekrit');
});

test("tells a thread's agent once when deploying what it shipped fails", async () => {
	const { repo, sam, id } = await startedThread(
		'deploy-fails',
		[writeNotes('# Notes\\n'), say('Done.')],
		undefined,
		{ '.agents/deploy': 'echo "no route to production"; exit 4\n' }
	);
	await untilThread(repo, id, (detail) => detail.summary.status === 'needs-you');
	await repo.ship(id, { by: sam, email: 'sam@example.com', title: 'docs: add a title', body: '' });
	const failed = await untilMain(repo, (main) => !!main.deployFailure && !main.verifying);
	const shipped = sh(join(dir, 'deploy-fails.git'), 'rev-parse', 'main');
	expect(failed.deployFailure?.sha).toBe(shipped);
	const notice = `What this thread shipped as ${shipped.slice(0, 7)} passed \`main\`'s deploy checks, but deploying ${shipped.slice(0, 7)}, which includes it, failed, so it isn't live:`;

	for (const [text, reply] of [
		['Is it live?', 'No.'],
		['Anything else?', 'Nothing.']
	]) {
		await script('deploy-fails', [say(reply!)]);
		await repo.reply(id, { author: sam, text: text! });
		await untilThread(repo, id, (detail) =>
			detail.entries.some((entry) => entry.type === 'message' && entry.text === reply)
		);
		const query = JSON.stringify((await modelRequests('deploy-fails')).at(-1)!.query);
		expect(query.split(notice)).toHaveLength(2);
		expect(query).toContain('no route to production');
	}
});

test('does not deploy without a deploy script or while main is failing', async () => {
	const { repo, sam, id } = await startedThread(
		'undeployed',
		[writeNotes('No title\\n'), say('Done.')],
		undefined,
		{
			'.agents/checks.yml': `checks:
  - name: title
    run: grep -q '^# ' notes.md
    before: [deploy]
`
		}
	);
	await untilThread(repo, id, (detail) => detail.summary.status === 'idle');
	const seeded = sh(join(dir, 'undeployed.git'), 'rev-parse', 'main');
	await repo.landed({ repo: 'undeployed', ref: 'refs/heads/main', after: seeded, headline: '' });
	const red = await untilMain(repo, (main) => main.verified?.sha === seeded);
	expect(red).toMatchObject({
		verified: { passed: false, culprit: null },
		green: null,
		deployed: null
	});
	expect(red.verifying).toBeNull();

	const work = join(dir, 'undeployed-work');
	await commit(work, { 'notes.md': '# Notes\n' }, 'Add a title');
	sh(work, 'push', '--quiet', join(dir, 'undeployed.git'), 'main');
	const titled = sh(join(dir, 'undeployed.git'), 'rev-parse', 'main');
	await repo.landed({ repo: 'undeployed', ref: 'refs/heads/main', after: titled, headline: '' });
	const green = await untilMain(repo, (main) => main.green?.sha === titled && !main.verifying);
	expect(green).toMatchObject({ deployed: null, deployFailure: null });
	expect(await repo.deploySecrets(sam)).toEqual([]);
});
