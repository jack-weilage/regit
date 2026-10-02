import type { CloneRequest, CommitRequest, PushRequest } from '@regit/agent';
import { git } from './exec.ts';

function auth(token: string) {
	return {
		GIT_CONFIG_COUNT: '1',
		GIT_CONFIG_KEY_0: 'http.extraHeader',
		GIT_CONFIG_VALUE_0: `Authorization: Bearer ${token}`
	};
}

export async function clone(root: string, { remote, token, branch }: CloneRequest) {
	const args = ['clone', ...(branch ? ['--branch', branch] : []), remote, '.'];
	await git(root, args, auth(token));
}

export async function commit(root: string, { message, author }: CommitRequest) {
	await git(root, ['add', '--all']);
	if (!(await git(root, ['status', '--porcelain']))) return null;
	await git(root, [
		'-c',
		`user.name=${author.name}`,
		'-c',
		`user.email=${author.email}`,
		'commit',
		'--message',
		message
	]);
	return git(root, ['rev-parse', 'HEAD']);
}

export async function push(root: string, { token, ref }: PushRequest) {
	await git(root, ['push', 'origin', `HEAD:${ref}`], auth(token));
}
