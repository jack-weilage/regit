import { describe, expect, it } from "vitest";
import { DEFAULT_TEST_MATCH, TestTargeter, parseImports, resolveImport } from "../src/targeting";

/** A repository described as path to source text. Blob ids are just the paths. */
function repository(sources: Record<string, string>) {
	const files = new Map(Object.keys(sources).map((path) => [path, path]));
	let reads = 0;
	const targeter = new TestTargeter(async (oid) => {
		reads++;
		return sources[oid];
	});
	const select = (changed: Array<string | { path: string; deleted: boolean }>) =>
		targeter.select(
			files,
			changed.map((entry) => (typeof entry === "string" ? { path: entry, deleted: false } : entry)),
			{ testMatch: DEFAULT_TEST_MATCH },
		);
	return { select, reads: () => reads };
}

const SOURCES = {
	"src/core/result.ts": "export type Result = { ok: boolean };\n",
	"src/array/chunk.ts": 'import type { Result } from "../core/result";\nexport const chunk = () => {};\n',
	"src/array/chunk.test.ts": 'import { chunk } from "./chunk";\n',
	"src/array/zip.ts": 'export { chunk } from "./chunk.js";\n',
	"src/array/zip.test.ts": 'import { zip } from "./zip";\n',
	"src/string/slug.ts": "export const slug = () => {};\n",
	"src/string/slug.test.ts": 'const { slug } = await import("./slug");\n',
	"src/string/index.ts": 'export * from "./slug";\n',
	"src/data/words.json": "[]\n",
	"src/string/words.ts": 'import words from "../data/words.json";\nexport default words;\n',
	"src/string/words.test.ts": 'import words from "./words";\nvi.mock("./slug");\n',
	"src/untested.ts": "export const lonely = 1;\n",
	"README.md": "# readme\n",
	"package.json": "{}\n",
};

describe("parseImports", () => {
	it("finds static, re-exported, dynamic, required and mocked specifiers", () => {
		const source = `
			import a from "./a";
			import { b } from './b.js';
			import "./side-effect";
			export * from "./c";
			export { d } from "./d";
			const e = await import("./e");
			const f = require("./f");
			vi.mock("./g");
			import type { H } from "./h";
		`;
		expect(parseImports(source).sort()).toEqual(
			["./a", "./b.js", "./c", "./d", "./e", "./f", "./g", "./h", "./side-effect"].sort(),
		);
	});

	it("does not treat a method named import or a plain string as an import", () => {
		expect(parseImports('loader.import("./x");\nconst label = "./not-a-module";\n')).toEqual([]);
	});
});

describe("resolveImport", () => {
	const files = new Map(Object.keys(SOURCES).map((path) => [path, path]));

	it("resolves extensionless, .js-for-.ts, index and exact paths", () => {
		expect(resolveImport("./chunk", "src/array/zip.ts", files)).toBe("src/array/chunk.ts");
		expect(resolveImport("./chunk.js", "src/array/zip.ts", files)).toBe("src/array/chunk.ts");
		expect(resolveImport("../string", "src/array/zip.ts", files)).toBe("src/string/index.ts");
		expect(resolveImport("../data/words.json", "src/string/words.ts", files)).toBe("src/data/words.json");
	});

	it("ignores packages and paths that do not exist", () => {
		expect(resolveImport("vitest", "src/array/zip.ts", files)).toBeNull();
		expect(resolveImport("./missing", "src/array/zip.ts", files)).toBeNull();
	});
});

describe("TestTargeter", () => {
	it("selects the tests that reach a changed file, directly or through other modules", async () => {
		const selection = await repository(SOURCES).select(["src/array/chunk.ts"]);
		expect(selection).toMatchObject({
			mode: "targeted",
			tests: ["src/array/chunk.test.ts", "src/array/zip.test.ts"],
			totalTests: 4,
		});
		// Everything those tests depend on, which is what a later change must not touch.
		expect(selection.reach).toEqual([
			"src/array/chunk.test.ts",
			"src/array/chunk.ts",
			"src/array/zip.test.ts",
			"src/array/zip.ts",
			"src/core/result.ts",
		]);
	});

	it("follows a shared module to every test that depends on it", async () => {
		const selection = await repository(SOURCES).select(["src/core/result.ts"]);
		expect(selection.tests).toEqual(["src/array/chunk.test.ts", "src/array/zip.test.ts"]);
	});

	it("selects a changed test file itself, and tests that mock a changed module", async () => {
		const { select } = repository(SOURCES);
		expect((await select(["src/string/slug.test.ts"])).tests).toEqual(["src/string/slug.test.ts"]);
		expect((await select(["src/string/slug.ts"])).tests).toEqual(["src/string/slug.test.ts", "src/string/words.test.ts"]);
	});

	it("runs everything when a data file changes, because it is outside the module graph", async () => {
		expect(await repository(SOURCES).select(["src/data/words.json"])).toMatchObject({ mode: "full", reach: null });
	});

	it("needs no tests for documentation", async () => {
		expect(await repository(SOURCES).select(["README.md"])).toMatchObject({ mode: "targeted", tests: [], reach: [] });
	});

	it("runs everything for manifests, configuration, deletions and files no test reaches", async () => {
		const { select } = repository({ ...SOURCES, "vitest.config.ts": "export default {};\n" });
		for (const changed of [
			["package.json"],
			["vitest.config.ts"],
			[{ path: "src/array/old.ts", deleted: true }],
			["src/untested.ts"],
			["src/array/chunk.ts", "package.json"],
		]) {
			const selection = await select(changed);
			expect(selection, JSON.stringify(changed)).toMatchObject({ mode: "full", tests: [], reach: null, totalTests: 4 });
			expect(selection.reason).not.toBe("");
		}
	});

	it("parses each blob once, however many selections it serves", async () => {
		const { select, reads } = repository(SOURCES);
		await select(["src/array/chunk.ts"]);
		const afterFirst = reads();
		await select(["src/string/slug.ts"]);
		await select(["src/core/result.ts"]);
		expect(reads()).toBe(afterFirst);
	});
});
