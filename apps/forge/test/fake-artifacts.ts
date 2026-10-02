import { RpcTarget, WorkerEntrypoint } from 'cloudflare:workers';

interface FakeEnv {
	GIT_REMOTE: string;
}

function info(env: FakeEnv, name: string) {
	const now = new Date().toISOString();
	return {
		id: name,
		name,
		description: null,
		defaultBranch: 'main',
		remote: `${env.GIT_REMOTE}/${name}.git`,
		source: null,
		readOnly: false,
		createdAt: now,
		updatedAt: now,
		lastPushAt: null
	};
}

class FakeRepo extends RpcTarget {
	#env: FakeEnv;
	#name: string;

	constructor(env: FakeEnv, name: string) {
		super();
		this.#env = env;
		this.#name = name;
	}

	info() {
		return info(this.#env, this.#name);
	}

	fork(name: string) {
		return { ...info(this.#env, name), token: `token-${name}` };
	}

	createToken(scope: 'read' | 'write' = 'write', ttl = 86400) {
		const expiresAt = new Date(Date.now() + ttl * 1000).toISOString();
		return { id: `token-${this.#name}`, plaintext: `token-${this.#name}`, scope, expiresAt };
	}
}

export default class FakeArtifacts extends WorkerEntrypoint<FakeEnv> {
	create(name: string) {
		return { ...info(this.env, name), token: `token-${name}` };
	}

	get(name: string) {
		return new FakeRepo(this.env, name);
	}
}
