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

/** An existing blob to place at a path, by object id. */
export interface BlobRef {
	oid: string;
	/** Git file mode, for example "100644" or "100755". */
	mode: string;
}

/** A file change: new contents, an existing blob, or null to delete the path. */
export type FileChange = string | Uint8Array | BlobRef | null;

type TreeEntry = { mode: string; path: string; oid: string; type: "blob" | "tree" | "commit" };

function isBlobRef(change: FileChange): change is BlobRef {
	return typeof change === "object" && change !== null && !(change instanceof Uint8Array);
}

async function readEntries(ws: Workspace, treeOid: string | undefined): Promise<Map<string, TreeEntry>> {
	const entries = new Map<string, TreeEntry>();
	if (!treeOid) return entries;
	const { tree } = await git.readTree({ fs: ws.fs, dir: ws.dir, oid: treeOid, cache: ws.cache });
	for (const entry of tree) entries.set(entry.path, entry as TreeEntry);
	return entries;
}

async function editTree(
	ws: Workspace,
	treeOid: string | undefined,
	changes: Map<string, FileChange>,
): Promise<string | undefined> {
	const entries = await readEntries(ws, treeOid);

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

	const applyLeaf = async (name: string, change: FileChange) => {
		if (change === null) {
			entries.delete(name);
			return;
		}
		if (isBlobRef(change)) {
			entries.set(name, {
				mode: change.mode,
				path: name,
				oid: change.oid,
				type: change.mode === "160000" ? "commit" : "blob",
			});
			return;
		}
		const blob = typeof change === "string" ? new TextEncoder().encode(change) : change;
		const oid = await git.writeBlob({ fs: ws.fs, dir: ws.dir, blob });
		const existing = entries.get(name);
		entries.set(name, { mode: existing?.type === "blob" ? existing.mode : "100644", path: name, oid, type: "blob" });
	};
	const applySubtree = async (name: string, group: Map<string, FileChange>) => {
		const existing = entries.get(name);
		const childOid = await editTree(ws, existing?.type === "tree" ? existing.oid : undefined, group);
		if (childOid) entries.set(name, { mode: "040000", path: name, oid: childOid, type: "tree" });
		else if (existing?.type === "tree") entries.delete(name);
	};

	// A name can change between file and directory. A deleted file must go
	// before the directory that replaces it is built, and a new file must be
	// written after the directory it replaces is emptied.
	for (const [name, change] of leaves) if (change === null) await applyLeaf(name, change);
	for (const [name, group] of subtrees) await applySubtree(name, group);
	for (const [name, change] of leaves) if (change !== null) await applyLeaf(name, change);

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
	/** Defaults to the author. */
	committer?: Identity;
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
	const author = input.author ?? REGIT_IDENTITY;
	const committer = input.committer ?? author;
	const when = { timestamp: input.timestamp ?? Math.floor(Date.now() / 1000), timezoneOffset: 0 };
	return git.writeCommit({
		fs: ws.fs,
		dir: ws.dir,
		commit: {
			message: input.message.endsWith("\n") ? input.message : `${input.message}\n`,
			tree,
			parent: input.parent ? [input.parent] : [],
			author: { ...author, ...when },
			committer: { ...committer, ...when },
		},
	});
}

/** One path that differs between two trees. `oid` is null when the path was removed. */
export interface TreeChange {
	path: string;
	oid: string | null;
	mode: string | null;
}

async function diffTreeOids(
	ws: Workspace,
	before: string | undefined,
	after: string | undefined,
	prefix: string,
	out: TreeChange[],
): Promise<void> {
	if (before === after) return;
	const [a, b] = await Promise.all([readEntries(ws, before), readEntries(ws, after)]);
	for (const name of new Set([...a.keys(), ...b.keys()])) {
		const left = a.get(name);
		const right = b.get(name);
		const path = prefix + name;
		if (left && right && left.oid === right.oid && left.mode === right.mode) continue;
		const leftTree = left?.type === "tree" ? left.oid : undefined;
		const rightTree = right?.type === "tree" ? right.oid : undefined;
		if (leftTree || rightTree) await diffTreeOids(ws, leftTree, rightTree, `${path}/`, out);
		if (right && right.type !== "tree") out.push({ path, oid: right.oid, mode: right.mode });
		// The path held a file and now holds a directory or nothing.
		else if (left && left.type !== "tree") out.push({ path, oid: null, mode: null });
	}
}

/**
 * The files that differ between two commits, without reading any file
 * contents. Both commits must be in the workspace.
 */
export async function diffCommits(ws: Workspace, before: string, after: string): Promise<TreeChange[]> {
	const [a, b] = await Promise.all([
		git.readCommit({ fs: ws.fs, dir: ws.dir, oid: before, cache: ws.cache }),
		git.readCommit({ fs: ws.fs, dir: ws.dir, oid: after, cache: ws.cache }),
	]);
	const out: TreeChange[] = [];
	await diffTreeOids(ws, a.commit.tree, b.commit.tree, "", out);
	return out.sort((x, y) => (x.path < y.path ? -1 : x.path > y.path ? 1 : 0));
}

/** Turn a tree diff into the file changes that reproduce it on another commit. */
export function changesToFiles(changes: TreeChange[]): Record<string, FileChange> {
	const files: Record<string, FileChange> = {};
	for (const change of changes) {
		files[change.path] = change.oid === null || change.mode === null ? null : { oid: change.oid, mode: change.mode };
	}
	return files;
}

/** Every file in a commit, as a map from path to blob id. */
export async function listFiles(ws: Workspace, commit: string): Promise<Map<string, string>> {
	const { commit: object } = await git.readCommit({ fs: ws.fs, dir: ws.dir, oid: commit, cache: ws.cache });
	const files = new Map<string, string>();
	const walk = async (treeOid: string, prefix: string): Promise<void> => {
		for (const entry of (await readEntries(ws, treeOid)).values()) {
			if (entry.type === "tree") await walk(entry.oid, `${prefix}${entry.path}/`);
			else if (entry.type === "blob") files.set(prefix + entry.path, entry.oid);
		}
	};
	await walk(object.tree, "");
	return files;
}

/** Read a blob as text. */
export async function readBlobText(ws: Workspace, oid: string): Promise<string> {
	const { blob } = await git.readBlob({ fs: ws.fs, dir: ws.dir, oid, cache: ws.cache });
	return new TextDecoder().decode(blob);
}

/** Read a commit's message, author and parents. */
export async function readCommitInfo(
	ws: Workspace,
	oid: string,
): Promise<{ message: string; parents: string[]; tree: string; author: Identity & { timestamp: number } }> {
	const { commit } = await git.readCommit({ fs: ws.fs, dir: ws.dir, oid, cache: ws.cache });
	return {
		message: commit.message,
		parents: commit.parent,
		tree: commit.tree,
		author: { name: commit.author.name, email: commit.author.email, timestamp: commit.author.timestamp },
	};
}

export interface CandidateInput {
	fork: Remote;
	/** Ref in the fork holding the verified commit. */
	candidateRef: string;
	/** The commit the verifier tested. The fork ref must still point here. */
	expectOid: string;
	/** The trunk commit the verifier built it on. Must already be in the workspace. */
	expectBase: string;
}

export type CandidateFetch =
	| { ok: true; oid: string; changes: TreeChange[]; message: string; author: Identity }
	| { ok: false; reason: "candidate-missing" | "candidate-changed" | "not-on-base"; detail: string };

/**
 * Fetch a verified commit from an agent's fork and check that it is what the
 * verifier reported: the same commit, sitting directly on the expected base.
 */
export async function fetchCandidate(ws: Workspace, input: CandidateInput): Promise<CandidateFetch> {
	// The candidate is one commit on top of the base, so depth 2 bounds the download.
	const oid = await fetchRef(ws, input.fork, input.candidateRef, {
		depth: 2,
		have: input.expectBase,
		remoteName: "fork",
	});
	if (oid === null) {
		return { ok: false, reason: "candidate-missing", detail: `${input.candidateRef} not found in fork` };
	}
	if (oid !== input.expectOid) {
		return {
			ok: false,
			reason: "candidate-changed",
			detail: `${input.candidateRef} is at ${oid}, verifier reported ${input.expectOid}`,
		};
	}
	const info = await readCommitInfo(ws, oid);
	if (info.parents.length !== 1 || info.parents[0] !== input.expectBase) {
		return {
			ok: false,
			reason: "not-on-base",
			detail: `candidate parents are [${info.parents.join(", ")}], expected [${input.expectBase}]`,
		};
	}
	return {
		ok: true,
		oid,
		changes: await diffCommits(ws, input.expectBase, oid),
		message: info.message,
		author: { name: info.author.name, email: info.author.email },
	};
}

/**
 * Make sure a trunk commit is in the workspace, fetching recent history if it
 * is not. Returns false when the commit is too old to find.
 */
export async function ensureTrunkCommit(
	ws: Workspace,
	trunk: Remote,
	branch: string,
	oid: string,
	historyDepth = 50,
): Promise<boolean> {
	if (await ws.hasObject(oid)) return true;
	await fetchRef(ws, trunk, `refs/heads/${branch}`, { depth: 1, remoteName: "trunk" });
	if (await ws.hasObject(oid)) return true;
	await fetchRef(ws, trunk, `refs/heads/${branch}`, { depth: historyDepth, remoteName: "trunk" });
	return ws.hasObject(oid);
}

/** The commit a trunk branch points at, or null when the branch does not exist. */
export async function trunkHead(trunk: Remote, branch: string): Promise<string | null> {
	return (await listRemoteRefs(trunk)).get(`refs/heads/${branch}`) ?? null;
}

export interface LandInput extends CandidateInput {
	trunk: Remote;
	/** Trunk branch name, without `refs/heads/`. */
	branch: string;
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
 * Land a verified commit on trunk by fast-forward.
 *
 * The verifier (a sandbox that never sees a trunk token) leaves the verified
 * commit on a ref in the agent's fork. This fetches it, checks that it is the
 * commit that was verified and that it sits directly on the current trunk
 * head, then fast-forwards trunk to it.
 */
export async function land(ws: Workspace, input: LandInput): Promise<LandResult> {
	const head = await trunkHead(input.trunk, input.branch);
	if (head !== input.expectBase) {
		return {
			landed: false,
			reason: "trunk-moved",
			head,
			detail: `trunk is at ${head ?? "(no commits)"}, candidate was verified against ${input.expectBase}`,
		};
	}
	await ensureTrunkCommit(ws, input.trunk, input.branch, head);

	const candidate = await fetchCandidate(ws, input);
	if (!candidate.ok) return { landed: false, reason: candidate.reason, head, detail: candidate.detail };

	const pushed = await pushRef(ws, input.trunk, candidate.oid, `refs/heads/${input.branch}`, { remoteName: "trunk" });
	if (!pushed.ok) return { landed: false, reason: "push-rejected", head, detail: pushed.detail };
	return { landed: true, head: candidate.oid };
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
