import { RpcTarget, WorkerEntrypoint } from 'cloudflare:workers';

class FakeRepo extends RpcTarget {
	constructor(
		private remote: string,
		private name: string
	) {
		super();
	}

	info() {
		return { name: this.name, defaultBranch: 'main', remote: `${this.remote}/${this.name}.git` };
	}

	createToken(scope: 'read' | 'write') {
		return { plaintext: `artifact-${scope}` };
	}
}

export default class FakeGitArtifacts extends WorkerEntrypoint<{ GIT_REMOTE: string }> {
	get(name: string) {
		return new FakeRepo(this.env.GIT_REMOTE, name);
	}
}
