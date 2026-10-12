/**
 * The whole merge path, end to end, in workerd.
 *
 * Agents here are the stock git client. Artifacts is the local git server
 * with token checks, and the sandbox is a local command server, so every git
 * operation and every test run is real. Clef is off: risk comes from path
 * rules and test targeting alone.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type GitServer, runGit, startGitServer } from "./git-server";
import { type SandboxServer, startSandboxServer } from "./sandbox-server";
import { type TestWorker, startWorker } from "./worker-harness";

const REPO = "demo";

const test = (subject: string, call: string, expected: string) =>
	`import assert from "node:assert/strict";\nimport { test } from "node:test";\nimport { ${subject} } from "./${subject}.js";\n\ntest("${subject}", () => {\n\tassert.equal(${call}, ${expected});\n});\n`;

const SEED: Record<string, string> = {
	"regit.json": `${JSON.stringify({ install: "", test: "node --test" }, null, 2)}\n`,
	"package.json": `${JSON.stringify({ name: "demo", private: true, type: "module" }, null, 2)}\n`,
	"README.md": "# demo\n",
	"src/math/add.js": "export function add(a, b) {\n\treturn a + b;\n}\n",
	"src/math/add.test.js": test("add", "add(2, 3)", "5"),
	"src/math/mul.js":
		'import { add } from "./add.js";\n\nexport function mul(a, b) {\n\tlet total = 0;\n\tfor (let i = 0; i < b; i++) total = add(total, a);\n\treturn total;\n}\n',
	"src/math/mul.test.js": test("mul", "mul(3, 4)", "12"),
	"src/text/upper.js": "export function upper(text) {\n\treturn text.toUpperCase();\n}\n",
	"src/text/upper.test.js": test("upper", 'upper("ab")', '"AB"'),
	"src/text/title.js":
		'import { upper } from "./upper.js";\n\nexport function title(text) {\n\treturn upper(text.slice(0, 1)) + text.slice(1);\n}\n',
	"src/text/title.test.js": test("title", 'title("regit")', '"Regit"'),
};

interface TaskBundle {
	id: string;
	token: string;
	base: string;
	fork: { name: string; cloneUrl: string };
	trunk: { fetchUrl: string; branch: string };
	context: Array<Record<string, unknown>>;
}

interface Candidate {
	id: string;
	status: string;
	reason: string | null;
	attempts: number;
	landed: string | null;
	next?: string;
	// biome-ignore lint/suspicious/noExplicitAny: test assertions read into open-ended evidence
	detail: any;
}

let server: GitServer;
let sandbox: SandboxServer;
let worker: TestWorker;

beforeAll(async () => {
	server = await startGitServer({ auth: true });
	sandbox = await startSandboxServer();
	worker = await startWorker({
		REGIT_FAKE_ARTIFACTS_URL: server.origin,
		REGIT_FAKE_SANDBOX_URL: sandbox.origin,
		REGIT_CLEF: "off",
		REGIT_PARALLEL: "4",
	});
	const response = await worker.fetch("/repos", { method: "POST", body: JSON.stringify({ name: REPO, files: SEED }) });
	expect(response.status).toBe(201);
}, 90_000);

afterAll(async () => {
	await worker?.stop();
	await sandbox?.close();
	await server?.close();
});

async function createTask(agent: string, task: string, paths: string[] = []): Promise<TaskBundle> {
	const response = await worker.fetch(`/repos/${REPO}/tasks`, {
		method: "POST",
		body: JSON.stringify({ agent, task, paths }),
	});
	expect(response.status).toBe(201);
	return (await response.json()) as TaskBundle;
}

/** Do an agent's work with the stock git client: clone the fork, edit, commit, push. */
async function agentPush(bundle: TaskBundle, files: Record<string, string>): Promise<string> {
	const dir = server.scratch();
	await runGit(dirname(dir), "clone", "--quiet", bundle.fork.cloneUrl, dir);
	for (const [path, content] of Object.entries(files)) writeFileSync(join(dir, path), content);
	await runGit(dir, "add", "-A");
	await runGit(dir, "commit", "--quiet", "-m", "Agent work in progress");
	await runGit(dir, "push", "--quiet", "origin", "HEAD:refs/heads/work");
	return dir;
}

async function submit(bundle: TaskBundle, decision: string, rejected: Array<{ approach: string; why: string }> = []) {
	const response = await fetch(`${worker.origin}/repos/${REPO}/submit`, {
		method: "POST",
		headers: { authorization: `Bearer ${bundle.token}` },
		body: JSON.stringify({ task: bundle.id, ref: "work", thread: { decision, rejected } }),
	});
	return { status: response.status, body: (await response.json()) as { id: string; error?: string } };
}

/** Poll a candidate with its task token until it lands, is rejected or errors. */
async function settle(bundle: TaskBundle, id: string): Promise<Candidate> {
	const deadline = Date.now() + 60_000;
	for (;;) {
		const response = await fetch(`${worker.origin}/repos/${REPO}/candidates/${id}`, {
			headers: { authorization: `Bearer ${bundle.token}` },
		});
		const candidate = (await response.json()) as Candidate;
		if (!["queued", "verifying"].includes(candidate.status)) return candidate;
		if (Date.now() > deadline) throw new Error(`candidate ${id} did not settle: ${JSON.stringify(candidate)}`);
		await new Promise((resolve) => setTimeout(resolve, 150));
	}
}

async function work(agent: string, task: string, files: Record<string, string>, decision: string): Promise<Candidate> {
	const bundle = await createTask(agent, task);
	await agentPush(bundle, files);
	const submitted = await submit(bundle, decision);
	expect(submitted.status, JSON.stringify(submitted.body)).toBe(202);
	return settle(bundle, submitted.body.id);
}

const trunkHead = () => server.git(REPO, "rev-parse", "main").trim();
const trunkFile = (path: string) => server.git(REPO, "show", `main:${path}`);
const note = (ref: string, commit: string) => JSON.parse(server.git(REPO, "notes", `--ref=${ref}`, "show", commit));

describe("the merge path", () => {
	it("registers a trunk and reports its head", async () => {
		const response = await worker.fetch(`/repos/${REPO}`);
		const status = (await response.json()) as { head: string; branch: string };
		expect(status).toMatchObject({ name: REPO, branch: "main", head: trunkHead() });
	});

	it("lands a change after running only the tests that reach it, and records why", async () => {
		const before = trunkHead();
		const candidate = await work(
			"agent-a",
			"Document the add function",
			{ "src/math/add.js": "// Adds two numbers.\nexport function add(a, b) {\n\treturn a + b;\n}\n" },
			"Added a one-line comment because the function had no description.",
		);

		expect(candidate, JSON.stringify(candidate, null, 2)).toMatchObject({ status: "landed", attempts: 1 });
		const landed = candidate.landed as string;
		expect(trunkHead()).toBe(landed);
		expect(server.git(REPO, "rev-parse", "main~1").trim()).toBe(before);
		expect(trunkFile("src/math/add.js")).toContain("// Adds two numbers.");

		// mul imports add, so both of their tests run. The text tests do not.
		expect(candidate.detail.tests).toMatchObject({
			mode: "targeted",
			selected: 2,
			total: 4,
			files: ["src/math/add.test.js", "src/math/mul.test.js"],
			result: "pass",
		});
		expect(candidate.detail.landing.mode).toBe("direct");

		// One commit, authored by the agent, with the task as its subject.
		expect(server.git(REPO, "log", "-1", "--format=%an|%s", "main").trim()).toBe("agent-a|Document the add function");

		// The thread record and the evidence are plain git notes.
		expect(note("threads", landed)).toMatchObject({
			v: 1,
			candidate: candidate.id,
			threads: [{ agent: "agent-a", decision: "Added a one-line comment because the function had no description." }],
		});
		expect(note("evidence", landed)).toMatchObject({
			verified: { base: before },
			tests: { selected: 2, total: 4, result: "pass" },
			changed: ["src/math/add.js"],
		});
		expect(server.git(REPO, "log", "--notes=threads", "-1", "main")).toContain("Added a one-line comment");
		server.git(REPO, "fsck", "--strict");
	});

	it("lands a second change from another fork in sequence", async () => {
		const before = trunkHead();
		const candidate = await work(
			"agent-b",
			"Trim input before upper-casing",
			{ "src/text/upper.js": "export function upper(text) {\n\treturn text.trim().toUpperCase();\n}\n" },
			"Trim first, because callers pass user input with stray spaces.",
		);
		expect(candidate, JSON.stringify(candidate, null, 2)).toMatchObject({ status: "landed" });
		expect(server.git(REPO, "rev-parse", "main~1").trim()).toBe(before);
		expect(candidate.detail.tests.files).toEqual(["src/text/title.test.js", "src/text/upper.test.js"]);
	});

	it("rejects a conflicting change with the reason and the decision it collided with, then lands the fix", async () => {
		// Two agents start from the same trunk and rewrite the same line.
		const first = await createTask("agent-c", "Make add tolerate strings");
		const second = await createTask("agent-d", "Make add reject non-numbers");
		await agentPush(first, {
			"src/math/add.js": "// Adds two numbers.\nexport function add(a, b) {\n\treturn Number(a) + Number(b);\n}\n",
		});
		const dir = await agentPush(second, {
			"src/math/add.js":
				'// Adds two numbers.\nexport function add(a, b) {\n\tif (typeof a !== "number") throw new TypeError("a");\n\treturn a + b;\n}\n',
		});

		const landed = await settle(first, (await submit(first, "Coerce with Number() so form input works.")).body.id);
		expect(landed.status).toBe("landed");
		const head = trunkHead();

		const rejected = await settle(second, (await submit(second, "Throw on non-numbers to surface bad callers.")).body.id);
		expect(rejected, JSON.stringify(rejected, null, 2)).toMatchObject({ status: "rejected", reason: "conflict" });
		expect(rejected.detail.conflicts).toEqual(["src/math/add.js"]);
		expect(rejected.next).toContain("merge");
		// The agent is told what the other change decided, so it can resolve with that in mind.
		expect(rejected.detail.related[0]).toMatchObject({
			kind: "landed",
			path: "src/math/add.js",
			commit: head,
			record: { agent: "agent-c", decision: "Coerce with Number() so form input works." },
		});
		expect(trunkHead()).toBe(head);

		// The agent merges trunk, resolves the conflict and submits again.
		await runGit(dir, "pull", "--quiet", "--no-rebase", second.trunk.fetchUrl, "main").catch(() => undefined);
		writeFileSync(
			join(dir, "src/math/add.js"),
			'// Adds two numbers.\nexport function add(a, b) {\n\tif (Number.isNaN(Number(a))) throw new TypeError("a");\n\treturn Number(a) + Number(b);\n}\n',
		);
		await runGit(dir, "add", "-A");
		await runGit(dir, "commit", "--quiet", "--no-edit");
		await runGit(dir, "push", "--quiet", "origin", "HEAD:refs/heads/work");
		const retry = await settle(second, (await submit(second, "Keep the coercion, and throw only when it yields NaN.")).body.id);
		expect(retry, JSON.stringify(retry, null, 2)).toMatchObject({ status: "landed" });
		expect(trunkFile("src/math/add.js")).toContain("Number.isNaN");
		// A merge in the agent's branch still lands as one commit on trunk.
		expect(server.git(REPO, "rev-list", "--count", "--merges", "main").trim()).toBe("0");
	});

	it("rejects a change whose tests fail and leaves trunk alone", async () => {
		const before = trunkHead();
		const candidate = await work(
			"agent-e",
			"Speed up mul",
			{ "src/math/mul.js": "export function mul(a, b) {\n\treturn a + b;\n}\n" },
			"Replaced the loop with a single expression.",
		);
		expect(candidate, JSON.stringify(candidate, null, 2)).toMatchObject({ status: "rejected", reason: "tests-failed" });
		expect(candidate.detail.tests).toMatchObject({ mode: "targeted", files: ["src/math/mul.test.js"] });
		expect(`${candidate.detail.output.stdout}${candidate.detail.output.stderr}`).toContain("mul");
		expect(trunkHead()).toBe(before);
	});

	it("runs the whole suite when a change can affect any test", async () => {
		const candidate = await work(
			"agent-f",
			"Describe the package",
			{ "package.json": `${JSON.stringify({ name: "demo", private: true, type: "module", description: "demo" }, null, 2)}\n` },
			"Added a description so the package listing is not blank.",
		);
		expect(candidate, JSON.stringify(candidate, null, 2)).toMatchObject({ status: "landed" });
		expect(candidate.detail.tests).toMatchObject({ mode: "full", selected: 4, total: 4 });
		expect(candidate.detail.tests.reason).toContain("package.json");
	});

	it("lands a documentation change without running tests", async () => {
		const candidate = await work(
			"agent-g",
			"Expand the README",
			{ "README.md": "# demo\n\nA small library used to exercise regit.\n" },
			"Said what the repository is for.",
		);
		expect(candidate, JSON.stringify(candidate, null, 2)).toMatchObject({ status: "landed" });
		expect(candidate.detail.tests).toMatchObject({ mode: "targeted", selected: 0, result: "none needed" });
	});

	it("refuses a change to how the repository is tested unless the task was allowed to make one", async () => {
		const before = trunkHead();
		// A change that breaks add and rewrites the test command so nothing can fail.
		const sneaky = await work(
			"agent-q",
			"Simplify the test setup",
			{
				"regit.json": `${JSON.stringify({ install: "", test: "true" })}\n`,
				"src/math/add.js": "export function add(a, b) {\n\treturn 0;\n}\n",
			},
			"Replaced the test command with a faster one.",
		);
		expect(sneaky, JSON.stringify(sneaky, null, 2)).toMatchObject({ status: "rejected", reason: "protected-path" });
		expect(sneaky.detail.message).toContain("regit.json");

		// The same through package.json scripts, which the default test command would run.
		const scripts = await work(
			"agent-r",
			"Add a test script",
			{ "package.json": `${JSON.stringify({ name: "demo", private: true, type: "module", description: "demo", scripts: { test: "exit 0" } })}\n` },
			"Added a test script so npm test works.",
		);
		expect(scripts, JSON.stringify(scripts, null, 2)).toMatchObject({ status: "rejected", reason: "protected-path" });
		expect(trunkHead()).toBe(before);

		// The admin can create a task that is allowed to, and it still has to pass the current suite.
		const response = await worker.fetch(`/repos/${REPO}/tasks`, {
			method: "POST",
			body: JSON.stringify({ agent: "agent-s", task: "Name the test files explicitly", allowProtected: true }),
		});
		const bundle = (await response.json()) as TaskBundle;
		await agentPush(bundle, {
			"regit.json": `${JSON.stringify({ install: "", test: "node --test", testMatch: "\\.test\\.js$" }, null, 2)}\n`,
		});
		const allowed = await settle(bundle, (await submit(bundle, "Pinned testMatch so only .test.js files count as tests.")).body.id);
		expect(allowed, JSON.stringify(allowed, null, 2)).toMatchObject({ status: "landed" });
		expect(allowed.detail.tests).toMatchObject({ mode: "full", selected: 4 });
	});

	it("lands two changes verified at once when neither can affect the other", async () => {
		await worker.fetch(`/repos/${REPO}/pause`, { method: "POST" });
		const math = await createTask("agent-h", "Rename a loop variable in mul");
		const text = await createTask("agent-i", "Handle empty strings in title");
		await agentPush(math, {
			"src/math/mul.js":
				'import { add } from "./add.js";\n\nexport function mul(a, b) {\n\tlet total = 0;\n\tfor (let step = 0; step < b; step++) total = add(total, a);\n\treturn total;\n}\n',
		});
		await agentPush(text, {
			"src/text/title.js":
				'import { upper } from "./upper.js";\n\nexport function title(text) {\n\tif (text === "") return "";\n\treturn upper(text.slice(0, 1)) + text.slice(1);\n}\n',
		});
		const before = trunkHead();
		const mathId = (await submit(math, "Renamed i to step for readability.")).body.id;
		const textId = (await submit(text, "Return early for the empty string to avoid slicing it.")).body.id;
		await worker.fetch(`/repos/${REPO}/resume`, { method: "POST" });

		const [first, second] = await Promise.all([settle(math, mathId), settle(text, textId)]);
		expect(first, JSON.stringify(first, null, 2)).toMatchObject({ status: "landed", attempts: 1 });
		expect(second, JSON.stringify(second, null, 2)).toMatchObject({ status: "landed", attempts: 1 });

		// Both were verified against the same head. The first landed as verified,
		// and the second was replayed on top of it without running its tests again.
		expect(first.detail.verified.base).toBe(before);
		expect(second.detail.verified.base).toBe(before);
		expect(first.detail.landing.mode).toBe("direct");
		expect(second.detail.landing).toMatchObject({ mode: "replayed", onto: first.landed, intervening: [first.landed] });
		expect(server.git(REPO, "rev-parse", "main").trim()).toBe(second.landed);
		expect(server.git(REPO, "rev-parse", "main~1").trim()).toBe(first.landed);
		expect(trunkFile("src/math/mul.js")).toContain("step");
		expect(trunkFile("src/text/title.js")).toContain('if (text === "")');
		// The replayed commit keeps the agent as author and names the integrator as committer.
		expect(server.git(REPO, "log", "-1", "--format=%an|%cn", "main").trim()).toBe("agent-i|regit integrator");
		expect(note("threads", second.landed as string).threads[0].agent).toBe("agent-i");
		server.git(REPO, "fsck", "--strict");
	});

	it("verifies a change again when something its tests depend on landed first", async () => {
		await worker.fetch(`/repos/${REPO}/pause`, { method: "POST" });
		const add = await createTask("agent-j", "Reword the add comment");
		const mul = await createTask("agent-k", "Guard mul against negative counts");
		const current = trunkFile("src/math/add.js");
		await agentPush(add, { "src/math/add.js": current.replace("// Adds two numbers.", "// Returns the sum of two numbers.") });
		await agentPush(mul, {
			"src/math/mul.js":
				'import { add } from "./add.js";\n\nexport function mul(a, b) {\n\tif (b < 0) return -mul(a, -b);\n\tlet total = 0;\n\tfor (let step = 0; step < b; step++) total = add(total, a);\n\treturn total;\n}\n',
		});
		const addId = (await submit(add, "Reworded the comment to say what is returned.")).body.id;
		const mulId = (await submit(mul, "Negative counts recurse on the positive count and negate.")).body.id;
		await worker.fetch(`/repos/${REPO}/resume`, { method: "POST" });

		const [first, second] = await Promise.all([settle(add, addId), settle(mul, mulId)]);
		expect(first).toMatchObject({ status: "landed", attempts: 1 });
		// mul's tests import add.js, which the first change modified, so its result is stale.
		expect(second, JSON.stringify(second, null, 2)).toMatchObject({ status: "landed", attempts: 2 });
		expect(second.detail.verified.base).toBe(first.landed);
		expect(second.detail.landing.mode).toBe("direct");

		const events = (await (await worker.fetch(`/repos/${REPO}/events`)).json()) as {
			events: Array<{ candidateId: string | null; kind: string; data: { reason?: string; message?: string } }>;
		};
		const requeued = events.events.find((event) => event.candidateId === mulId && event.kind === "candidate.requeued");
		expect(requeued?.data.reason).toBe("trunk-moved");
		expect(requeued?.data.message).toContain("src/math/add.js");
	});

	it("answers why: what landed on a path, and what was tried and rejected", async () => {
		const bundle = await createTask("agent-l", "Look around", ["src/math"]);
		// The task bundle already carries the context for the paths the task named.
		expect(bundle.context.length).toBeGreaterThan(0);

		const response = await fetch(`${worker.origin}/repos/${REPO}/why?path=src/math/mul.js`, {
			headers: { authorization: `Bearer ${bundle.token}` },
		});
		const { decisions } = (await response.json()) as {
			decisions: Array<{ kind: string; commit: string | null; record: { agent: string; decision: string; reason?: string } }>;
		};
		const landed = decisions.filter((entry) => entry.kind === "landed").map((entry) => entry.record.agent);
		expect(landed).toEqual(["agent-k", "agent-h"]);
		const rejected = decisions.find((entry) => entry.kind === "rejected");
		expect(rejected).toMatchObject({
			commit: null,
			record: { agent: "agent-e", decision: "Replaced the loop with a single expression.", reason: "tests-failed" },
		});
	});

	it("lets a stock git client read the decisions straight from trunk", async () => {
		const bundle = await createTask("agent-m", "Read history");
		const dir = server.scratch();
		await runGit(dirname(dir), "clone", "--quiet", bundle.trunk.fetchUrl, dir);
		await runGit(dir, "fetch", "--quiet", "origin", "refs/notes/*:refs/notes/*");
		const log = await runGit(dir, "log", "--notes=threads", "--format=%s%n%N", "-3");
		expect(log).toContain("Negative counts recurse on the positive count and negate.");
		expect(log).toContain("Reworded the comment to say what is returned.");
	});
});

describe("who may do what", () => {
	it("requires a token", async () => {
		expect((await fetch(`${worker.origin}/repos/${REPO}/candidates`)).status).toBe(401);
		expect((await fetch(`${worker.origin}/repos/${REPO}/tasks`, { method: "POST", body: "{}" })).status).toBe(401);
	});

	it("limits a task token to its own task", async () => {
		const mine = await createTask("agent-n", "Mine");
		const theirs = await createTask("agent-o", "Theirs");
		await agentPush(theirs, { "README.md": "# demo\n\nTheirs.\n" });
		const submitted = await submit(theirs, "Changed the README to mark the fork.");
		await settle(theirs, submitted.body.id);

		const asMine = { authorization: `Bearer ${mine.token}` };
		expect((await fetch(`${worker.origin}/repos/${REPO}/candidates/${submitted.body.id}`, { headers: asMine })).status).toBe(404);
		expect((await fetch(`${worker.origin}/repos/${REPO}/candidates`, { headers: asMine })).status).toBe(401);
		const forged = await fetch(`${worker.origin}/repos/${REPO}/submit`, {
			method: "POST",
			headers: asMine,
			body: JSON.stringify({ task: theirs.id, ref: "work", thread: { decision: "Not mine to submit." } }),
		});
		expect(forged.status).toBe(404);
		expect((await fetch(`${worker.origin}/repos/${REPO}/tasks`, { method: "POST", headers: asMine, body: "{}" })).status).toBe(401);
	});

	it("gives agents and sandboxes nothing that can write to trunk", async () => {
		const bundle = await createTask("agent-p", "Try to push to trunk");
		const dir = await agentPush(bundle, { "README.md": "# demo\n\nAttempt.\n" });

		// The trunk URL an agent is handed can fetch and cannot push.
		await expect(runGit(dir, "push", bundle.trunk.fetchUrl, "HEAD:refs/heads/main")).rejects.toThrow();
		// Nor can the agent's fork token be used against trunk.
		const forkSecret = new URL(bundle.fork.cloneUrl).password;
		const trunkWithForkToken = new URL(bundle.trunk.fetchUrl);
		trunkWithForkToken.password = forkSecret;
		await expect(runGit(dir, "push", trunkWithForkToken.toString(), "HEAD:refs/heads/main")).rejects.toThrow();

		// Every trunk URL the sandboxes were given is equally unable to push.
		const trunkUrls = new Set<string>();
		for (const { argv } of sandbox.commands) {
			if (argv[0] === "git" && argv[1] === "remote" && argv[3] === "trunk") trunkUrls.add(argv[4]);
		}
		expect(trunkUrls.size).toBeGreaterThan(5);
		for (const url of trunkUrls) {
			await expect(runGit(dir, "push", url, "HEAD:refs/heads/main")).rejects.toThrow();
		}
		expect(readFileSync(join(dir, "README.md"), "utf8")).toContain("Attempt.");
		expect(trunkFile("README.md")).not.toContain("Attempt.");
	});

	it("removes the git remotes from a sandbox before running install or tests there", () => {
		const bySandbox = new Map<string, string[]>();
		for (const { id, argv } of sandbox.commands) {
			const list = bySandbox.get(id) ?? [];
			list.push(argv.slice(0, 4).join(" "));
			bySandbox.set(id, list);
		}
		let checked = 0;
		for (const commands of bySandbox.values()) {
			const firstTest = commands.findIndex((command) => command.startsWith("sh -c"));
			if (firstTest === -1) continue;
			checked++;
			const before = commands.slice(0, firstTest);
			expect(before).toContain("git remote remove trunk");
			expect(before).toContain("git remote remove fork");
			expect(before.some((command) => command.startsWith("rm -f .git/FETCH_HEAD"))).toBe(true);
		}
		expect(checked).toBeGreaterThan(5);
	});

	it("destroys every sandbox it started", () => {
		expect(sandbox.live()).toEqual([]);
	});
});
