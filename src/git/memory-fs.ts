/**
 * An in-memory filesystem with the subset of `fs.promises` that isomorphic-git
 * needs. Workers have no disk, so every git operation regit performs in a
 * Worker or Durable Object runs against one of these.
 *
 * Errors carry Node-style `code` values (ENOENT, EEXIST, ...) because
 * isomorphic-git branches on them.
 */

type DirNode = { kind: "dir"; children: Map<string, Node>; mtimeMs: number };
type FileNode = { kind: "file"; data: Uint8Array; mtimeMs: number; mode: number };
type LinkNode = { kind: "link"; target: string; mtimeMs: number };
type Node = DirNode | FileNode | LinkNode;

class FsError extends Error {
	code: string;
	constructor(code: string, path: string) {
		super(`${code}: ${path}`);
		this.code = code;
	}
}

class Stats {
	constructor(private node: Node) {}
	get type() {
		return this.node.kind === "dir" ? "dir" : this.node.kind === "link" ? "symlink" : "file";
	}
	get mode() {
		if (this.node.kind === "dir") return 0o040000;
		if (this.node.kind === "link") return 0o120000;
		return this.node.mode;
	}
	get size() {
		if (this.node.kind === "file") return this.node.data.byteLength;
		if (this.node.kind === "link") return this.node.target.length;
		return 0;
	}
	get mtimeMs() {
		return this.node.mtimeMs;
	}
	get ctimeMs() {
		return this.node.mtimeMs;
	}
	get ino() {
		return 0;
	}
	get uid() {
		return 0;
	}
	get gid() {
		return 0;
	}
	get dev() {
		return 0;
	}
	isFile() {
		return this.node.kind === "file";
	}
	isDirectory() {
		return this.node.kind === "dir";
	}
	isSymbolicLink() {
		return this.node.kind === "link";
	}
}

function split(path: string): string[] {
	const parts: string[] = [];
	for (const part of path.split("/")) {
		if (part === "" || part === ".") continue;
		if (part === "..") parts.pop();
		else parts.push(part);
	}
	return parts;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export class MemoryFS {
	private root: DirNode = { kind: "dir", children: new Map(), mtimeMs: Date.now() };

	/** Total bytes held in file contents. Used to report workspace size. */
	get byteLength(): number {
		let total = 0;
		const walk = (node: Node) => {
			if (node.kind === "file") total += node.data.byteLength;
			else if (node.kind === "dir") for (const child of node.children.values()) walk(child);
		};
		walk(this.root);
		return total;
	}

	private lookup(path: string): Node | undefined {
		let node: Node = this.root;
		for (const part of split(path)) {
			if (node.kind !== "dir") return undefined;
			const next = node.children.get(part);
			if (!next) return undefined;
			node = next;
		}
		return node;
	}

	private parentOf(path: string): { dir: DirNode | undefined; name: string } {
		const parts = split(path);
		const name = parts.pop() ?? "";
		const dir = this.lookup(parts.join("/"));
		return { dir: dir?.kind === "dir" ? dir : undefined, name };
	}

	private mkdirp(path: string): DirNode {
		let node: DirNode = this.root;
		for (const part of split(path)) {
			let next = node.children.get(part);
			if (!next) {
				next = { kind: "dir", children: new Map(), mtimeMs: Date.now() };
				node.children.set(part, next);
			}
			if (next.kind !== "dir") throw new FsError("ENOTDIR", path);
			node = next;
		}
		return node;
	}

	promises = {
		readFile: async (path: string, options?: string | { encoding?: string }) => {
			const node = this.lookup(path);
			if (!node) throw new FsError("ENOENT", path);
			if (node.kind !== "file") throw new FsError("EISDIR", path);
			const encoding = typeof options === "string" ? options : options?.encoding;
			return encoding ? decoder.decode(node.data) : node.data;
		},

		writeFile: async (
			path: string,
			data: string | Uint8Array | ArrayBuffer,
			options?: string | { mode?: number },
		) => {
			const parts = split(path);
			const name = parts.pop();
			if (!name) throw new FsError("EISDIR", path);
			const dir = this.mkdirp(parts.join("/"));
			const existing = dir.children.get(name);
			if (existing?.kind === "dir") throw new FsError("EISDIR", path);
			const bytes =
				typeof data === "string"
					? encoder.encode(data)
					: data instanceof Uint8Array
						? data.slice()
						: new Uint8Array(data.slice(0));
			const mode =
				(typeof options === "object" && options?.mode) ||
				(existing?.kind === "file" ? existing.mode : 0o100644);
			dir.children.set(name, { kind: "file", data: bytes, mtimeMs: Date.now(), mode });
		},

		unlink: async (path: string) => {
			const { dir, name } = this.parentOf(path);
			const node = dir?.children.get(name);
			if (!dir || !node) throw new FsError("ENOENT", path);
			if (node.kind === "dir") throw new FsError("EISDIR", path);
			dir.children.delete(name);
		},

		readdir: async (path: string) => {
			const node = this.lookup(path);
			if (!node) throw new FsError("ENOENT", path);
			if (node.kind !== "dir") throw new FsError("ENOTDIR", path);
			return [...node.children.keys()].sort();
		},

		mkdir: async (path: string, options?: number | { recursive?: boolean }) => {
			if (typeof options === "object" && options?.recursive) {
				this.mkdirp(path);
				return;
			}
			const { dir, name } = this.parentOf(path);
			if (!name) return; // root
			if (!dir) throw new FsError("ENOENT", path);
			if (dir.children.has(name)) throw new FsError("EEXIST", path);
			dir.children.set(name, { kind: "dir", children: new Map(), mtimeMs: Date.now() });
		},

		rmdir: async (path: string) => {
			const { dir, name } = this.parentOf(path);
			const node = dir?.children.get(name);
			if (!dir || !node) throw new FsError("ENOENT", path);
			if (node.kind !== "dir") throw new FsError("ENOTDIR", path);
			if (node.children.size > 0) throw new FsError("ENOTEMPTY", path);
			dir.children.delete(name);
		},

		stat: async (path: string) => {
			let node = this.lookup(path);
			// Follow one level of symlink, which is all git ever creates here.
			if (node?.kind === "link") node = this.lookup(node.target);
			if (!node) throw new FsError("ENOENT", path);
			return new Stats(node);
		},

		lstat: async (path: string) => {
			const node = this.lookup(path);
			if (!node) throw new FsError("ENOENT", path);
			return new Stats(node);
		},

		readlink: async (path: string) => {
			const node = this.lookup(path);
			if (!node) throw new FsError("ENOENT", path);
			if (node.kind !== "link") throw new FsError("EINVAL", path);
			return node.target;
		},

		symlink: async (target: string, path: string) => {
			const parts = split(path);
			const name = parts.pop();
			if (!name) throw new FsError("EEXIST", path);
			const dir = this.mkdirp(parts.join("/"));
			dir.children.set(name, { kind: "link", target, mtimeMs: Date.now() });
		},

		chmod: async (path: string, mode: number) => {
			const node = this.lookup(path);
			if (!node) throw new FsError("ENOENT", path);
			if (node.kind === "file") node.mode = mode;
		},
	};
}
