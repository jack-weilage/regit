/**
 * Test targeting: which test files can a change affect?
 *
 * The integrator builds the import graph of the candidate commit from the
 * blobs it already holds, then selects the test files that reach a changed
 * file. This is static analysis of import statements, not coverage data, so
 * anything it cannot see through falls back to the full suite.
 *
 * The integrator computes this, not the sandbox, because the sandbox runs
 * agent-written code and should not get to choose which tests judge it.
 */

export interface TargetConfig {
	/** Matches test file paths. */
	testMatch: RegExp;
}

export const DEFAULT_TEST_MATCH = /(^|\/)(__tests__\/.+|[^/]+\.(test|spec))\.[cm]?[jt]sx?$/;

export interface ChangedFile {
	path: string;
	/** True when the candidate removes the file. */
	deleted: boolean;
}

export interface Selection {
	mode: "targeted" | "full";
	/** Why this mode was chosen, in plain words. */
	reason: string;
	/** Test files to run when targeted. Empty when the full suite runs. */
	tests: string[];
	/** How many test files the repository has. */
	totalTests: number;
	/**
	 * Every file the selected tests depend on, including the tests. A later
	 * change to any of these invalidates the result. Null means every file.
	 */
	reach: string[] | null;
}

const MODULE = /\.[cm]?[jt]sx?$/;
/**
 * Changes to these cannot affect a test run: licence files and Markdown at
 * the repository root or under docs/. Anything else that is not a module,
 * including text and Markdown elsewhere, may be a fixture and gets the full suite.
 */
const INERT = /^(LICENSE|LICENSE\.md|LICENSE\.txt|NOTICE|NOTICE\.md|\.gitignore|[^/]+\.md|docs\/.+\.mdx?)$/;
/** Import specifiers that point inside the repository without being relative. */
const ALIAS = /^(@\/|~\/|#)/;
/** Changes to these can affect any test without being imported by it. */
const GLOBAL = [
	/(^|\/)package\.json$/,
	/(^|\/)(package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?)$/,
	/(^|\/)tsconfig[^/]*\.json$/,
	/(^|\/)[^/]+\.config\.[cm]?[jt]s$/,
	/(^|\/)regit\.json$/,
	/(^|\/)\.(npmrc|nvmrc|node-version)$/,
	/^\.github\//,
];

const IMPORT_PATTERNS = [
	// import x from "y"; import "y"; export * from "y"
	/(?:^|[^.\w$])(?:import|export)\b[^'"`;()]*?['"]([^'"\n]+)['"]/g,
	// import("y") and require("y")
	/(?:^|[^.\w$])(?:import|require)\s*\(\s*['"]([^'"\n]+)['"]/g,
	// vi.mock("y"), jest.mock("y") and friends
	/\b(?:vi|jest)\.(?:mock|doMock|unmock|importActual|importMock|requireActual)\s*\(\s*['"]([^'"\n]+)['"]/g,
];

/** The module specifiers a source file imports. */
export function parseImports(source: string): string[] {
	const found = new Set<string>();
	for (const pattern of IMPORT_PATTERNS) {
		for (const match of source.matchAll(pattern)) found.add(match[1]);
	}
	return [...found];
}

function normalize(path: string): string {
	const parts: string[] = [];
	for (const part of path.split("/")) {
		if (part === "" || part === ".") continue;
		if (part === "..") parts.pop();
		else parts.push(part);
	}
	return parts.join("/");
}

const EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];

/** Resolve a relative import to a file in the repository, the way TypeScript and bundlers do. */
export function resolveImport(specifier: string, from: string, files: ReadonlyMap<string, string>): string | null {
	if (!specifier.startsWith("./") && !specifier.startsWith("../")) return null;
	const base = normalize(`${from.slice(0, from.lastIndexOf("/") + 1)}${specifier}`);
	if (files.has(base)) return base;
	// TypeScript sources import "./x.js" and mean "./x.ts".
	const stem = base.replace(/\.[cm]?jsx?$/, "");
	for (const candidate of stem === base ? [base] : [stem, base]) {
		for (const extension of EXTENSIONS) {
			if (files.has(candidate + extension)) return candidate + extension;
		}
		for (const extension of EXTENSIONS) {
			if (files.has(`${candidate}/index${extension}`)) return `${candidate}/index${extension}`;
		}
	}
	return null;
}

/**
 * Builds import graphs from blobs. Import lists are cached by blob id, so a
 * new commit only costs the files it changed.
 */
export class TestTargeter {
	private importsByBlob = new Map<string, string[]>();

	constructor(private readBlob: (oid: string) => Promise<string>) {}

	private async importsOf(oid: string): Promise<string[]> {
		let imports = this.importsByBlob.get(oid);
		if (!imports) {
			imports = parseImports(await this.readBlob(oid));
			this.importsByBlob.set(oid, imports);
		}
		return imports;
	}

	/**
	 * @param files every file in the candidate commit, path to blob id
	 * @param changed the files the candidate changes relative to its base
	 */
	async select(files: ReadonlyMap<string, string>, changed: ChangedFile[], config: TargetConfig): Promise<Selection> {
		const tests = [...files.keys()].filter((path) => config.testMatch.test(path)).sort();
		const full = (reason: string): Selection => ({
			mode: "full",
			reason,
			tests: [],
			totalTests: tests.length,
			reach: null,
		});

		const relevant = changed.filter((file) => !INERT.test(file.path));
		for (const file of relevant) {
			// A path segment that starts with "-" could be read as an option by the test runner.
			if (file.path.split("/").some((segment) => segment.startsWith("-"))) {
				return full(`${file.path} has a name a test runner could read as an option`);
			}
			if (GLOBAL.some((pattern) => pattern.test(file.path))) {
				return full(`${file.path} can affect any test`);
			}
			if (file.deleted) return full(`${file.path} was deleted, and its dependents are not known from this commit`);
			if (!MODULE.test(file.path)) return full(`${file.path} is outside the import graph`);
		}
		if (relevant.length === 0) {
			return { mode: "targeted", reason: "only documentation changed", tests: [], totalTests: tests.length, reach: [] };
		}

		// Direct dependencies of each file, resolved once.
		const dependencies = new Map<string, string[]>();
		let alias: string | null = null;
		const directOf = async (path: string): Promise<string[]> => {
			let direct = dependencies.get(path);
			if (!direct) {
				direct = [];
				const oid = files.get(path);
				if (oid && MODULE.test(path)) {
					for (const specifier of await this.importsOf(oid)) {
						if (ALIAS.test(specifier)) alias ??= `${path} imports "${specifier}"`;
						const resolved = resolveImport(specifier, path, files);
						if (resolved) direct.push(resolved);
					}
				}
				dependencies.set(path, direct);
			}
			return direct;
		};
		const closureOf = async (test: string): Promise<Set<string>> => {
			const seen = new Set<string>([test]);
			const queue = [test];
			while (queue.length > 0) {
				for (const next of await directOf(queue.pop() as string)) {
					if (!seen.has(next)) {
						seen.add(next);
						queue.push(next);
					}
				}
			}
			return seen;
		};

		const changedPaths = new Set(relevant.map((file) => file.path));
		const selected: string[] = [];
		const reach = new Set<string>();
		for (const test of tests) {
			const closure = await closureOf(test);
			let hit = false;
			for (const path of changedPaths) {
				if (closure.has(path)) {
					hit = true;
					break;
				}
			}
			if (!hit) continue;
			selected.push(test);
			for (const path of closure) reach.add(path);
		}

		// Every test's imports have been read by now, so an alias anywhere is known.
		if (alias) return full(`${alias}, a path alias this analysis cannot follow`);
		if (selected.length === 0) {
			return full("no test file reaches the changed files");
		}
		const unreached = relevant.find((file) => !reach.has(file.path));
		if (unreached) return full(`no test file reaches ${unreached.path}`);
		return {
			mode: "targeted",
			reason: `${selected.length} of ${tests.length} test files reach the changed files`,
			tests: selected,
			totalTests: tests.length,
			reach: [...reach].sort(),
		};
	}
}

/**
 * The first path in `a` that collides with a path in `b`: the same path, or
 * one that is a directory containing the other (a file can become a
 * directory and the reverse).
 */
export function collision(a: Iterable<string>, b: ReadonlySet<string>): string | null {
	const ancestors = new Set<string>();
	for (const path of b) {
		for (let slash = path.indexOf("/"); slash !== -1; slash = path.indexOf("/", slash + 1)) {
			ancestors.add(path.slice(0, slash));
		}
	}
	for (const path of a) {
		if (b.has(path) || ancestors.has(path)) return path;
		for (let slash = path.indexOf("/"); slash !== -1; slash = path.indexOf("/", slash + 1)) {
			if (b.has(path.slice(0, slash))) return path;
		}
	}
	return null;
}
