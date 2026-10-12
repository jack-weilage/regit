/** Access to bindings, with the seams the local test suite needs. */
import { fakeArtifacts } from "./dev/fake-artifacts";

declare global {
	interface Env {
		/** Set only by the local test suite: the origin of the stand-in git server. */
		REGIT_FAKE_ARTIFACTS_URL?: string;
		/** Set only by the local test suite: the origin of the stand-in sandbox. */
		REGIT_FAKE_SANDBOX_URL?: string;
		/** "off" disables the decision model. Path rules and test targeting still apply. */
		REGIT_CLEF?: string;
		/** How many candidates are verified at once. Defaults to 6. */
		REGIT_PARALLEL?: string;
	}
}

/** The Artifacts binding, or the test stand-in when the suite has configured one. */
export function artifactsOf(env: Env): Artifacts {
	return env.REGIT_FAKE_ARTIFACTS_URL ? fakeArtifacts(env.REGIT_FAKE_ARTIFACTS_URL) : env.ARTIFACTS;
}

/** The Workers AI binding when the decision model is enabled, otherwise undefined. */
export function clefOf(env: Env): Ai | undefined {
	if (env.REGIT_CLEF === "off") return undefined;
	return (env as { AI?: Ai }).AI;
}

export function parallelismOf(env: Env): number {
	const value = Number(env.REGIT_PARALLEL ?? 6);
	return Number.isInteger(value) && value > 0 ? Math.min(value, 32) : 6;
}
