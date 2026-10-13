import type { CheckResult } from './threads.ts';

// How far a shipped thread's commit has come since it landed on main.
export type Verdict = 'landed' | 'passed' | 'failed' | 'deployed' | 'reverted';

export type VerifyStage = 'checking' | 'rechecking' | 'bisecting' | 'deploying' | 'reverting';

export interface Culprit {
	sha: string;
	headline: string;
	thread: string | null;
}

export interface Verifying {
	sha: string;
	stage: VerifyStage;
	note: string | null;
	since: number;
	started: number;
}

// Main is checked after commits land and the newest green commit is deployed.
export interface MainStatus {
	branch: string | null;
	verifying: Verifying | null;
	verified: {
		sha: string;
		at: number;
		passed: boolean;
		results: CheckResult[];
		culprit: Culprit | null;
	} | null;
	green: { sha: string; at: number } | null;
	deployed: { sha: string; at: number } | null;
	deployFailure: { sha: string; at: number; output: string } | null;
	// Verifying itself broke down, for example when the sandbox couldn't start.
	failure: { sha: string; at: number; error: string } | null;
}

export interface DeploySecret {
	name: string;
	updatedAt: number;
	updatedBy: string;
}

export const deploySecretName = /^[A-Z_][A-Z0-9_]{0,127}$/;

export const maxDeploySecretBytes = 64 * 1024;
