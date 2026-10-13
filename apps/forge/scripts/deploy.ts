import { $ } from 'bun';

// The sandbox image is built from apps/sandbox; each deploy records which tree it came from.
const committed = (await $`git rev-parse HEAD:apps/sandbox`.text()).trim();
const dirty = (await $`git status --porcelain -- ../sandbox`.text()).trim();
const tree = dirty ? `uncommitted-${committed}` : committed;

await $`wrangler d1 migrations apply regit --remote`;

if ((await $`docker info`.quiet().nothrow()).exitCode === 0) {
	await $`wrangler deploy --var SANDBOX_TREE:${tree}`;
} else {
	const deployed = await deployedTree();
	if (deployed !== tree)
		throw new Error(
			`apps/sandbox changed since its image was deployed (${deployed ?? 'unrecorded'}, now ${tree}). Without Docker the image can't be rebuilt, so deploy forge where Docker runs.`
		);
	console.log('Docker is unavailable; reusing the deployed sandbox image');
	await $`wrangler deploy --containers-rollout=none --var SANDBOX_TREE:${tree}`;
}

async function deployedTree() {
	const { CLOUDFLARE_ACCOUNT_ID: account, CLOUDFLARE_API_TOKEN: token } = process.env;
	if (!account || !token)
		throw new Error('Start Docker, or set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN');
	const response = await fetch(
		`https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/regit-forge/settings`,
		{ headers: { Authorization: `Bearer ${token}` } }
	);
	if (!response.ok)
		throw new Error(`Could not read the deployed forge settings: ${await response.text()}`);
	const { result } = (await response.json()) as {
		result: { bindings: { name: string; type: string; text?: string }[] };
	};
	return result.bindings.find((binding) => binding.name === 'SANDBOX_TREE')?.text ?? null;
}
