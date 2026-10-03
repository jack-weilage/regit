import { goto } from '$app/navigation';
import { isHttpError } from '@sveltejs/kit';
import type { NewRepo } from '@regit/ui';
import { createRepo } from '#lib/data.remote.ts';

export async function createAndOpen(repo: NewRepo) {
	try {
		await createRepo(repo);
		await goto(`/${repo.name}`);
	} catch (cause) {
		throw new Error(
			isHttpError(cause) ? cause.body.message : 'The repository could not be created.'
		);
	}
}
