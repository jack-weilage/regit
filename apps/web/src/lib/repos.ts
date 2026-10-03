import { goto } from '$app/navigation';
import { isHttpError } from '@sveltejs/kit';
import type { NewRepo } from '@regit/ui';
import { createRepo } from '#lib/forge.remote.ts';

export async function createAndOpen(repo: NewRepo) {
	try {
		const created = await createRepo(repo);
		await goto(`/${created.name}`);
	} catch (cause) {
		throw new Error(
			isHttpError(cause) ? cause.body.message : 'The repository could not be created.'
		);
	}
}
