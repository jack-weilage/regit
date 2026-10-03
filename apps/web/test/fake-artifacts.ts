import { WorkerEntrypoint } from 'cloudflare:workers';

export default class FakeArtifacts extends WorkerEntrypoint {
	fake() {
		return true;
	}

	create(name: string) {
		return { name, remote: `https://artifacts.test/${name}.git`, defaultBranch: 'main' };
	}

	import({ source, target }: { source: { url: string }; target: { name: string } }) {
		if (source.url.includes('unreachable')) throw new Error('The import failed');
		return this.create(target.name);
	}
}
