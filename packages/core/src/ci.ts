import type { Author } from './threads.ts';

export type CiStatus = 'preparing' | 'running' | 'passed' | 'failed' | 'cancelled';

export type CiStepStatus = 'pending' | 'running' | 'passed' | 'failed' | 'skipped' | 'cancelled';

export interface CiStep {
	name: string;
	command: string;
	status: CiStepStatus;
	startedAt: number | null;
	finishedAt: number | null;
	exitCode: number | null;
	logSize: number;
}

export interface CiRun {
	id: string;
	sha: string;
	branch: string;
	headline: string;
	status: CiStatus;
	by: string | null;
	startedAt: number;
	finishedAt: number | null;
	error: string | null;
	steps: CiStep[];
}

export interface QueuedCiRun {
	sha: string;
	branch: string;
	headline: string;
}

export interface CiRuns {
	runs: CiRun[];
	queued: QueuedCiRun | null;
}

export const ciPrepareStep = 'Prepare';

export const ciSecretPattern = /^(?!REGIT_)[A-Z_][A-Z0-9_]{0,63}$/;

export const ciSecretRule =
	'Use uppercase letters, digits and underscores, not starting with a digit or REGIT_.';

export interface CiApi {
	runs(): CiRuns;
	log(id: string, step: string): string | null;
	secrets(): string[];
	setSecret(name: string, value: string, by: Author): Promise<void>;
	deleteSecret(name: string, by: Author): Promise<void>;
	rerun(id: string, by: Author): Promise<void>;
	cancel(id: string, by: Author): Promise<void>;
}
