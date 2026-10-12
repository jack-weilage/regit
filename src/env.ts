/** Access to bindings, with the seams the local test suite needs. */
import { fakeArtifacts } from "./dev/fake-artifacts";

declare global {
	interface Env {
		/** Set only by the local test suite: the origin of the stand-in git server. */
		REGIT_FAKE_ARTIFACTS_URL?: string;
	}
}

/** The Artifacts binding, or the test stand-in when the suite has configured one. */
export function artifactsOf(env: Env): Artifacts {
	return env.REGIT_FAKE_ARTIFACTS_URL ? fakeArtifacts(env.REGIT_FAKE_ARTIFACTS_URL) : env.ARTIFACTS;
}
