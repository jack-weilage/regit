import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import { blockingFailures, type DeployResponse } from '@regit/agent';
import type { CheckResult, Culprit, VerifyStage } from '@regit/core';
import { emptyTree } from './main-sandbox.ts';
import { plain } from './ship-thread.ts';

export interface Verification {
	id: string;
	repo: string;
	sha: string;
	green: string | null;
}

export interface Verified {
	id: string;
	sha: string;
	results: CheckResult[];
	commits: string[];
	culprit: Omit<Culprit, 'thread'> | null;
}

const checking = {
	retries: { limit: 3, delay: '30 seconds', backoff: 'exponential' },
	timeout: '6 hours'
} as const;

const short = (sha: string) => sha.slice(0, 7);

// Checks a commit that landed on main and deploys it when it passes. A failure is checked again to rule out a flake,
// then bisected across the commits since the last passing one to find the commit that broke it.
export class VerifyMain extends WorkflowEntrypoint<Env, Verification> {
	override async run({ payload }: WorkflowEvent<Verification>, step: WorkflowStep) {
		const { id, repo, sha, green } = payload;
		const repos = () => this.env.REPOS.getByName(repo);
		const main = () => this.env.MAIN.getByName(`main-${repo}`);
		const progress = (stage: VerifyStage, note: string | null = null) =>
			repos()
				.verifyProgress(id, stage, note)
				.catch((error: unknown) => console.warn('Could not report verification progress', error));
		const check = (name: string, commit: string, stage: VerifyStage, only?: string[]) =>
			step.do(name, checking, async () => {
				await progress(stage, stage === 'bisecting' ? `Checking ${short(commit)}` : null);
				return plain<CheckResult[]>(
					await main().check({ repo, sha: commit, base: green ?? emptyTree, ...(only && { only }) })
				);
			});
		try {
			const commits = await step.do('list the landed commits', async () =>
				plain<{ sha: string; headline: string }[]>(
					await main().commits({ repo, from: green, to: sha })
				)
			);
			let results = await check(`check ${short(sha)}`, sha, 'checking');
			const failed = blockingFailures(results).map(({ name }) => name);
			if (failed.length) {
				const again = await check(`check ${short(sha)} again`, sha, 'rechecking', failed);
				results = results.map((result) =>
					result.status === 'failed' &&
					again.some(({ name, status }) => name === result.name && status === 'passed')
						? {
								...result,
								status: 'warned',
								output: `Failed, then passed when run again, so it may be flaky.\n${result.output}`
							}
						: result
				);
			}
			const failing = blockingFailures(results).map(({ name }) => name);
			let culprit: Verified['culprit'] = null;
			if (failing.length && green) {
				let good = -1;
				let bad = commits.length - 1;
				while (bad - good > 1) {
					const mid = Math.floor((good + bad) / 2);
					const { sha: commit } = commits[mid]!;
					const midResults = await check(
						`bisect at ${short(commit)}`,
						commit,
						'bisecting',
						failing
					);
					if (blockingFailures(midResults).length) bad = mid;
					else good = mid;
				}
				culprit = commits[bad] ?? { sha, headline: '' };
			}
			const { deploy } = await step.do('report the checks', async () =>
				plain<{ deploy: boolean }>(
					await repos().verified({
						id,
						sha,
						results,
						commits: commits.map((commit) => commit.sha),
						culprit
					})
				)
			);
			if (!deploy) return;
			const deployed = await step.do(
				'deploy',
				{ retries: { limit: 2, delay: '30 seconds', backoff: 'constant' }, timeout: '2 hours' },
				async () => {
					await progress('deploying');
					return plain<DeployResponse>(await main().deploy({ repo, sha }));
				}
			);
			await step.do('report the deploy', () =>
				repos().deployFinished({ id, sha, deploy: deployed, commits: commits.map((c) => c.sha) })
			);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			await step.do('report the failure', () => repos().verifyFailed(id, message));
		}
	}
}

export interface Revert {
	id: string;
	repo: string;
	thread: string | null;
	commits: Omit<Culprit, 'thread'>[];
	reason: string;
}

// Reverts commits that broke main, newest first, when the thread that shipped them couldn't fix them.
export class RevertShip extends WorkflowEntrypoint<Env, Revert> {
	override async run({ payload }: WorkflowEvent<Revert>, step: WorkflowStep) {
		const { id, repo, commits, reason } = payload;
		const repos = () => this.env.REPOS.getByName(repo);
		try {
			let reverted: { sha: string; branch: string } | null = null;
			for (const { sha, headline } of [...commits].reverse())
				reverted = await step.do(
					`revert ${short(sha)}`,
					{ retries: { limit: 3, delay: '10 seconds', backoff: 'exponential' } },
					async () =>
						plain<{ sha: string; branch: string }>(
							await this.env.REPOSITORY_GIT.getByName(`ship-${repo}`).revert({
								repo,
								sha,
								message: `Revert "${headline}"\n\n${reason}`
							})
						)
				);
			await step.do('report the revert', () => repos().reverted(id, reverted));
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			await step.do('report the failure', () => repos().revertFailed(id, message));
		}
	}
}
