/**
 * Git operations regit performs from a Worker or Durable Object.
 *
 * The Artifacts Workers binding can create, fork and read repositories but
 * cannot write to them, so every commit, landing and note is a git push made
 * with isomorphic-git over an in-memory filesystem.
 *
 * Nothing here touches a working tree or an index: commits are built from
 * objects, and refs are moved with fast-forward pushes.
 */
import git, { Errors } from "isomorphic-git";
import http from "isomorphic-git/http/web";
import { MemoryFS } from "./memory-fs";

/** A git remote plus the Artifacts repo token that grants access to it. */
export interface Remote {
	url: string;
	/** Artifacts token, with or without its `?expires=` suffix. Omit for unauthenticated remotes. */
	token?: string;
}

export interface Identity {
	name: string;
	email: string;
}

export const NOTES_THREADS = "refs/notes/threads";
export const NOTES_EVIDENCE = "refs/notes/evidence";

export const REGIT_IDENTITY: Identity = { name: "regit integrator", email: "integrator@regit.invalid" };

const ZERO_OID = "0".repeat(40);
/** Local ref used to tell a remote which commit we already hold during a fetch. */
const HAVE_REF = "refs/regit/have";

/** Artifacts tokens look like `art_v1_<secret>?expires=<unix>`; git wants only the secret. */
export function tokenSecret(token: string): string {
	return token.split("?expires=")[0];
}

/** An authenticated remote URL for a stock git client, for example inside a sandbox. */
export function authenticatedUrl(remote: Remote): string {
	if (!remote.token) return remote.url;
	const url = new URL(remote.url);
	url.username = "x";
	url.password = tokenSecret(remote.token);
	return url.toString();
}

function authHeaders(remote: Remote): Record<string, string> {
	if (!remote.token) return {};
	return { Authorization: `Basic ${btoa(`x:${tokenSecret(remote.token)}`)}` };
}

function isNotFound(error: unknown): boolean {
	return error instanceof Errors.NotFoundError || (error as { code?: string })?.code === "NotFoundError";
}

/**
 * An in-memory git repository. A Durable Object keeps one alive between
 * landings so later fetches only download what changed.
 */
export class Workspace {
	readonly fs = new MemoryFS();
	readonly dir = "/repo";
	/** isomorphic-git's parsed-packfile cache. */
	readonly cache: object = {};
	private remotes = new Map<string, string>();

	static async create(): Promise<Workspace> {
		const ws = new Workspace();
		await git.init({ fs: ws.fs, dir: ws.dir, defaultBranch: "main" });
		return ws;
	}

	/** Bytes held in memory, to decide when to throw a workspace away. */
	get byteLength(): number {
		return this.fs.byteLength;
	}

	/** isomorphic-git refuses to fetch from a remote that has no configured refspec. */
	async ensureRemote(name: string, url: string): Promise<void> {
		if (this.remotes.get(name) === url) return;
		await git.addRemote({ fs: this.fs, dir: this.dir, remote: name, url, force: true });
		this.remotes.set(name, url);
	}

	async hasObject(oid: string): Promise<boolean> {
		try {
			await git.readObject({ fs: this.fs, dir: this.dir, oid, format: "deflated", cache: this.cache });
			return true;
		} catch {
			return false;
		}
	}

	async setRef(ref: string, oid: string | null): Promise<void> {
		if (oid === null) {
			await git.deleteRef({ fs: this.fs, dir: this.dir, ref }).catch(() => {});
			return;
		}
		await git.writeRef({ fs: this.fs, dir: this.dir, ref, value: oid, force: true });
	}
}

/** Every ref the remote advertises, as a map from full ref name to object id. */
export async function listRemoteRefs(remote: Remote): Promise<Map<string, string>> {
	const refs = await git.listServerRefs({
		http,
		url: remote.url,
		headers: authHeaders(remote),
		protocolVersion: 1,
	});
	return new Map(refs.map((entry) => [entry.ref, entry.oid]));
}

export interface FetchOptions {
	/** Limit history to this many commits. Omit for full history. */
	depth?: number;
	/** A commit already in the workspace, so the remote sends only what is new. */
	have?: string | null;
	/** Name for the configured remote. Defaults to "origin". */
	remoteName?: string;
}

/**
 * Fetch one ref into the workspace.
 * @returns the object id the ref points at, or null if the remote has no such ref.
 */
export async function fetchRef(
	ws: Workspace,
	remote: Remote,
	remoteRef: string,
	options: FetchOptions = {},
): Promise<string | null> {
	const remoteName = options.remoteName ?? "origin";
	await ws.ensureRemote(remoteName, remote.url);
	const have = options.have && (await ws.hasObject(options.have)) ? options.have : null;
	await ws.setRef(HAVE_REF, have);
	try {
		const result = await git.fetch({
			fs: ws.fs,
			http,
			dir: ws.dir,
			cache: ws.cache,
			url: remote.url,
			remote: remoteName,
			// `ref` is the local ref isomorphic-git reports as already held.
			ref: HAVE_REF,
			remoteRef,
			singleBranch: true,
			tags: false,
			depth: options.depth,
			headers: authHeaders(remote),
		});
		return result.fetchHead ?? null;
	} catch (error) {
		if (isNotFound(error)) return null;
		throw error;
	}
}

export type PushOutcome =
	| { ok: true }
	| { ok: false; reason: "not-fast-forward" | "rejected"; detail: string };

/**
 * Push a commit in the workspace to a ref on the remote. Fast-forward only
 * unless `force` is set.
 */
export async function pushRef(
	ws: Workspace,
	remote: Remote,
	oid: string,
	remoteRef: string,
	options: { force?: boolean; remoteName?: string } = {},
): Promise<PushOutcome> {
	const remoteName = options.remoteName ?? "origin";
	await ws.ensureRemote(remoteName, remote.url);
	const localRef = "refs/regit/push";
	await ws.setRef(localRef, oid);
	try {
		await git.push({
			fs: ws.fs,
			http,
			dir: ws.dir,
			cache: ws.cache,
			url: remote.url,
			remote: remoteName,
			ref: localRef,
			remoteRef,
			force: options.force ?? false,
			headers: authHeaders(remote),
		});
		return { ok: true };
	} catch (error) {
		if (error instanceof Errors.PushRejectedError) {
			return { ok: false, reason: "not-fast-forward", detail: error.message };
		}
		if (error instanceof Errors.GitPushError) {
			return { ok: false, reason: "rejected", detail: error.message };
		}
		throw error;
	}
}

/** A file change: new contents, or null to delete the path. */
export type FileChange = string | Uint8Array | null;

async function editTree(
	ws: Workspace,
	treeOid: string | undefined,
	changes: Map<string, FileChange>,
): Promise<string | undefined> {
	type Entry = { mode: string; path: string; oid: string; type: "blob" | "tree" | "commit" };
	const entries = new Map<string, Entry>();
	if (treeOid) {
		const { tree } = await git.readTree({ fs: ws.fs, dir: ws.dir, oid: treeOid, cache: ws.cache });
		for (const entry of tree) entries.set(entry.path, entry as Entry);
	}

	const leaves = new Map<string, FileChange>();
	const subtrees = new Map<string, Map<string, FileChange>>();
	for (const [path, change] of changes) {
		const slash = path.indexOf("/");
		if (slash === -1) {
			leaves.set(path, change);
			continue;
		}
		const head = path.slice(0, slash);
		let group = subtrees.get(head);
		if (!group) subtrees.set(head, (group = new Map()));
		group.set(path.slice(slash + 1), change);
	}

	for (const [name, change] of leaves) {
		if (change === null) {
			entries.delete(name);
			continue;
		}
		const blob = typeof change === "string" ? new TextEncoder().encode(change) : change;
		const oid = await git.writeBlob({ fs: ws.fs, dir: ws.dir, blob });
		const existing = entries.get(name);
		const mode = existing?.type === "blob" ? existing.mode : "100644";
		entries.set(name, { mode, path: name, oid, type: "blob" });
	}

	for (const [name, group] of subtrees) {
		const existing = entries.get(name);
		const childOid = await editTree(ws, existing?.type === "tree" ? existing.oid : undefined, group);
		if (childOid) entries.set(name, { mode: "040000", path: name, oid: childOid, type: "tree" });
		else entries.delete(name);
	}

	if (entries.size === 0) return undefined;
	return git.writeTree({ fs: ws.fs, dir: ws.dir, tree: [...entries.values()] });
}

export interface CommitInput {
	/** Parent commit, which must be in the workspace. Omit for a root commit. */
	parent?: string | null;
	/** Paths to write or delete, relative to the repository root. */
	files: Record<string, FileChange>;
	message: string;
	author?: Identity;
	/** Unix seconds. Defaults to now. */
	timestamp?: number;
}

/** Create a commit from file changes without a working tree. Returns the commit id. */
export async function commitFiles(ws: Workspace, input: CommitInput): Promise<string> {
	let baseTree: string | undefined;
	if (input.parent) {
		const { commit } = await git.readCommit({ fs: ws.fs, dir: ws.dir, oid: input.parent, cache: ws.cache });
		baseTree = commit.tree;
	}
	const tree =
		(await editTree(ws, baseTree, new Map(Object.entries(input.files)))) ??
		(await git.writeTree({ fs: ws.fs, dir: ws.dir, tree: [] }));
	const identity = input.author ?? REGIT_IDENTITY;
	const stamp = { ...identity, timestamp: input.timestamp ?? Math.floor(Date.now() / 1000), timezoneOffset: 0 };
	return git.writeCommit({
		fs: ws.fs,
		dir: ws.dir,
		commit: {
			message: input.message.endsWith("\n") ? input.message : `${input.message}\n`,
			tree,
			parent: input.parent ? [input.parent] : [],
			author: stamp,
			committer: stamp,
		},
	});
}

export interface LandInput {
	trunk: Remote;
	fork: Remote;
	/** Trunk branch name, without `refs/heads/`. */
	branch: string;
	/** Ref in the fork holding the verified commit. */
	candidateRef: string;
	/** The commit the verifier tested. The fork ref must still point here. */
	expectOid: string;
	/** The trunk head the verifier rebased onto. Trunk must still point here. */
	expectBase: string;
}

export type LandResult =
	| { landed: true; head: string }
	| {
			landed: false;
			reason: "trunk-moved" | "candidate-changed" | "candidate-missing" | "not-on-base" | "push-rejected";
			/** Trunk head at the time of the attempt, when known. */
			head: string | null;
			detail: string;
	  };

/**
 * Land a verified commit on trunk.
 *
 * The verifier (a sandbox that never sees a trunk token) leaves the verified
 * commit on a ref in the agent's fork. This fetches it, checks that it is the
 * commit that was verified and that it sits directly on the current trunk
 * head, then fast-forwards trunk to it.
 */
export async function land(ws: Workspace, input: LandInput): Promise<LandResult> {
	const trunkRef = `refs/heads/${input.branch}`;
	const refs = await listRemoteRefs(input.trunk);
	const head = refs.get(trunkRef) ?? null;
	if (head !== input.expectBase) {
		return {
			landed: false,
			reason: "trunk-moved",
			head,
			detail: `trunk is at ${head ?? "(no commits)"}, candidate was verified against ${input.expectBase}`,
		};
	}

	if (!(await ws.hasObject(head))) {
		await fetchRef(ws, input.trunk, trunkRef, { depth: 1, remoteName: "trunk" });
	}

	// The candidate is one commit on top of the base, so depth 2 bounds the download.
	const candidate = await fetchRef(ws, input.fork, input.candidateRef, {
		depth: 2,
		have: head,
		remoteName: "fork",
	});
	if (candidate === null) {
		return { landed: false, reason: "candidate-missing", head, detail: `${input.candidateRef} not found in fork` };
	}
	if (candidate !== input.expectOid) {
		return {
			landed: false,
			reason: "candidate-changed",
			head,
			detail: `${input.candidateRef} is at ${candidate}, verifier tested ${input.expectOid}`,
		};
	}

	const { commit } = await git.readCommit({ fs: ws.fs, dir: ws.dir, oid: candidate, cache: ws.cache });
	if (commit.parent.length !== 1 || commit.parent[0] !== head) {
		return {
			landed: false,
			reason: "not-on-base",
			head,
			detail: `candidate parents are [${commit.parent.join(", ")}], expected [${head}]`,
		};
	}

	const pushed = await pushRef(ws, input.trunk, candidate, trunkRef, { remoteName: "trunk" });
	if (!pushed.ok) {
		return { landed: false, reason: "push-rejected", head, detail: pushed.detail };
	}
	return { landed: true, head: candidate };
}

export interface NoteInput {
	/** Notes ref, for example `refs/notes/threads`. */
	ref: string;
	body: string;
}

/**
 * Attach notes to a commit on the remote. Each notes ref holds one note per
 * commit, so writing replaces any existing note for that commit on that ref.
 * @returns the new head of each notes ref.
 */
export async function writeNotes(
	ws: Workspace,
	remote: Remote,
	commit: string,
	notes: NoteInput[],
	options: { author?: Identity; remoteName?: string; timestamp?: number } = {},
): Promise<Record<string, string>> {
	const identity = options.author ?? REGIT_IDENTITY;
	const stamp = { ...identity, timestamp: options.timestamp ?? Math.floor(Date.now() / 1000), timezoneOffset: 0 };
	const heads: Record<string, string> = {};

	for (const note of notes) {
		let lastDetail = "";
		for (let attempt = 0; attempt < 2; attempt++) {
			const local = await git
				.resolveRef({ fs: ws.fs, dir: ws.dir, ref: note.ref })
				.catch(() => null);
			const remoteHead = await fetchRef(ws, remote, note.ref, {
				depth: 1,
				have: local,
				remoteName: options.remoteName,
			});
			await ws.setRef(note.ref, remoteHead);

			const head = await git.addNote({
				fs: ws.fs,
				dir: ws.dir,
				cache: ws.cache,
				ref: note.ref,
				oid: commit,
				note: note.body,
				force: true,
				author: stamp,
				committer: stamp,
			});
			const pushed = await pushRef(ws, remote, head, note.ref, { remoteName: options.remoteName });
			if (pushed.ok) {
				heads[note.ref] = head;
				break;
			}
			lastDetail = pushed.detail;
			if (attempt === 1) throw new Error(`could not push ${note.ref}: ${lastDetail}`);
		}
	}
	return heads;
}

/** Read one commit's note from a notes ref on the remote, or null if there is none. */
export async function readNote(
	ws: Workspace,
	remote: Remote,
	ref: string,
	commit: string,
	options: { remoteName?: string } = {},
): Promise<string | null> {
	const local = await git.resolveRef({ fs: ws.fs, dir: ws.dir, ref }).catch(() => null);
	const head = await fetchRef(ws, remote, ref, { depth: 1, have: local, remoteName: options.remoteName });
	if (head === null) return null;
	await ws.setRef(ref, head);
	try {
		const bytes = await git.readNote({ fs: ws.fs, dir: ws.dir, cache: ws.cache, ref, oid: commit });
		return new TextDecoder().decode(bytes);
	} catch (error) {
		if (isNotFound(error)) return null;
		throw error;
	}
}

function pktLine(payload: string): Uint8Array {
	const body = new TextEncoder().encode(payload);
	const length = (body.byteLength + 4).toString(16).padStart(4, "0");
	const out = new Uint8Array(4 + body.byteLength);
	out.set(new TextEncoder().encode(length), 0);
	out.set(body, 4);
	return out;
}

/**
 * Send one raw ref-update command to the remote, stating which object id the
 * ref is expected to hold. Both object ids must already exist on the remote,
 * so no objects are sent.
 *
 * isomorphic-git always reads the current value before pushing, which makes it
 * impossible to test what a server does with a stale expectation. This exists
 * for that test: a server that enforces compare-and-swap rejects the update
 * when `expectOid` is wrong.
 */
export async function rawRefUpdate(
	remote: Remote,
	update: { ref: string; expectOid: string | null; newOid: string },
): Promise<{ accepted: boolean; response: string }> {
	const command = pktLine(`${update.expectOid ?? ZERO_OID} ${update.newOid} ${update.ref}\0report-status\n`);
	const flush = new TextEncoder().encode("0000");
	// An empty packfile: signature, version 2, zero objects, then its SHA-1.
	const packHeader = new Uint8Array([0x50, 0x41, 0x43, 0x4b, 0, 0, 0, 2, 0, 0, 0, 0]);
	const packSum = new Uint8Array(await crypto.subtle.digest("SHA-1", packHeader));
	const body = new Uint8Array(command.byteLength + flush.byteLength + packHeader.byteLength + packSum.byteLength);
	let offset = 0;
	for (const part of [command, flush, packHeader, packSum]) {
		body.set(part, offset);
		offset += part.byteLength;
	}

	const response = await fetch(`${remote.url.replace(/\/$/, "")}/git-receive-pack`, {
		method: "POST",
		headers: {
			...authHeaders(remote),
			"Content-Type": "application/x-git-receive-pack-request",
			Accept: "application/x-git-receive-pack-result",
		},
		body,
	});
	const text = await response.text();
	const accepted = response.ok && text.includes("unpack ok") && text.includes(`ok ${update.ref}`);
	return { accepted, response: `${response.status} ${text.replace(/[^\x20-\x7e]+/g, " ").trim()}` };
}
