/**
 * The control routes: registering a trunk, handing out tasks, taking
 * submissions and answering questions about what happened.
 *
 * Two kinds of caller exist. The admin token can do everything. A task token
 * is returned when a task is created and lets an agent submit work for that
 * task and read its outcome, so an agent never needs the admin token.
 */
import { remoteFor, waitForRepo, withRepo } from "./artifacts";
import { NOTE_CHAR_BUDGET, type NoteScreen, type ThreadRecord, screenNote, screenedState } from "./clef";
import { artifactsOf, clefOf } from "./env";
import { type FileChange, Workspace, authenticatedUrl, commitFiles, listRemoteRefs, pushRef } from "./git/ops";
import type { IntegratorApi, TaskRow } from "./integrator";

export function json(body: unknown, status = 200): Response {
	return new Response(`${JSON.stringify(body, null, 2)}\n`, {
		status,
		headers: { "content-type": "application/json; charset=utf-8" },
	});
}

class HttpError extends Error {
	constructor(
		readonly status: number,
		readonly body: Record<string, unknown>,
	) {
		super(String(body.error));
	}
}

const fail = (status: number, error: string, extra: Record<string, unknown> = {}): never => {
	throw new HttpError(status, { error, ...extra });
};

const REPO_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/;
const AGENT_NAME = /^[a-z0-9][a-z0-9-]{0,31}$/;
const TASK_TOKEN = /^rgt\.(t_[a-f0-9]{10})\.([a-f0-9]{48})$/;

async function sha256(text: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
	return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function randomHex(bytes: number): string {
	return [...crypto.getRandomValues(new Uint8Array(bytes))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function bearer(request: Request): string {
	const header = request.headers.get("authorization") ?? "";
	return header.startsWith("Bearer ") ? header.slice(7).trim() : "";
}

/** Compare two secrets by their hashes, so the comparison leaks nothing about either. */
export async function isAdmin(request: Request, env: Env): Promise<boolean> {
	const presented = bearer(request);
	if (!presented || !env.REGIT_ADMIN_TOKEN) return false;
	const [a, b] = await Promise.all([sha256(presented), sha256(env.REGIT_ADMIN_TOKEN)]);
	let difference = 0;
	for (let index = 0; index < a.length; index++) difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
	return difference === 0;
}

type Caller = { role: "admin" } | { role: "task"; task: TaskRow };

function integratorFor(env: Env, repo: string): IntegratorApi {
	return env.INTEGRATOR.getByName(repo) as unknown as IntegratorApi;
}

async function identify(request: Request, env: Env, repo: string): Promise<Caller> {
	if (await isAdmin(request, env)) return { role: "admin" };
	const match = bearer(request).match(TASK_TOKEN);
	if (match && REPO_NAME.test(repo)) {
		const task = await integratorFor(env, repo).authorizeTask(match[1], await sha256(match[2]));
		if (task) return { role: "task", task };
	}
	return fail(401, "A valid admin or task token is required.");
}

async function requireAdmin(request: Request, env: Env): Promise<void> {
	if (!env.REGIT_ADMIN_TOKEN) fail(503, "REGIT_ADMIN_TOKEN is not set on this Worker.");
	if (!(await isAdmin(request, env))) fail(401, "The admin token is required.");
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
	try {
		const body = await request.json();
		if (body && typeof body === "object" && !Array.isArray(body)) return body as Record<string, unknown>;
	} catch {
		// Fall through.
	}
	return fail(400, "The request body must be a JSON object.");
}

function text(value: unknown, field: string, max: number): string {
	if (typeof value !== "string" || value.trim() === "") return fail(422, `"${field}" must be a non-empty string.`);
	if (value.length > max) return fail(422, `"${field}" must be at most ${max} characters.`);
	return value.trim();
}

async function requireRepo(env: Env, repo: string): Promise<{ name: string; branch: string; head: string | null }> {
	if (!REPO_NAME.test(repo)) fail(404, "No such repository.");
	const status = await integratorFor(env, repo).status();
	if (!status) return fail(404, `"${repo}" is not registered with regit. Register it with POST /repos.`);
	return status as { name: string; branch: string; head: string | null };
}

/** POST /repos: register a trunk repository, creating, importing or adopting it. */
async function createRepo(request: Request, env: Env): Promise<Response> {
	await requireAdmin(request, env);
	const body = await readBody(request);
	const name = text(body.name, "name", 63);
	if (!REPO_NAME.test(name)) fail(422, '"name" may contain letters, digits, ".", "_" and "-".');
	const artifacts = artifactsOf(env);
	let branch: string;

	if (body.adopt === true) {
		// Use an Artifacts repository that already exists.
		branch = (await withRepo(artifacts, name, (repo) => repo.info())).defaultBranch;
	} else if (body.import && typeof body.import === "object") {
		const source = body.import as { url?: unknown; branch?: unknown };
		const imported = await artifacts.import({
			source: { url: text(source.url, "import.url", 2000), branch: typeof source.branch === "string" ? source.branch : undefined },
			target: { name },
		});
		await waitForRepo(artifacts, name, 180_000);
		branch = imported.defaultBranch;
	} else {
		const files: Record<string, FileChange> = {};
		if (body.files && typeof body.files === "object") {
			for (const [path, content] of Object.entries(body.files as Record<string, unknown>)) {
				if (typeof content === "string") files[path] = content;
			}
		}
		if (Object.keys(files).length === 0) files["README.md"] = `# ${name}\n`;
		const created = await artifacts.create(name, { setDefaultBranch: "main" });
		branch = created.defaultBranch;
		const ws = await Workspace.create();
		const head = await commitFiles(ws, { files, message: "Initial commit" });
		const pushed = await pushRef(ws, { url: created.remote, token: created.token }, head, `refs/heads/${branch}`);
		if (!pushed.ok) fail(502, `Could not seed the repository: ${pushed.detail}`);
	}

	await integratorFor(env, name).init({ name, branch });
	return json(await integratorFor(env, name).status(), 201);
}

/** POST /repos/:repo/tasks: fork trunk for an agent and hand back everything it needs. */
async function createTask(request: Request, env: Env, repo: string, origin: string): Promise<Response> {
	await requireAdmin(request, env);
	const trunk = await requireRepo(env, repo);
	const body = await readBody(request);
	const agent = text(body.agent, "agent", 32).toLowerCase();
	if (!AGENT_NAME.test(agent)) fail(422, '"agent" may contain lowercase letters, digits and "-".');
	const task = text(body.task, "task", 2000);
	const paths = Array.isArray(body.paths) ? body.paths.filter((path): path is string => typeof path === "string").slice(0, 20) : [];
	// Only the admin can let a task change how the repository is tested.
	const allowProtected = body.allowProtected === true;

	const artifacts = artifactsOf(env);
	const id = `t_${randomHex(5)}`;
	const forkName = `${repo}--${agent}-${id}`;
	await withRepo(artifacts, repo, (handle) =>
		handle.fork(forkName, { defaultBranchOnly: true, description: `regit task ${id} for ${agent}` }),
	);
	await waitForRepo(artifacts, forkName);

	// The agent may write to its own fork and read trunk. Nothing it holds can write to trunk.
	const [forkWrite, trunkRead] = await Promise.all([
		remoteFor(artifacts, forkName, "write", 6 * 3600),
		remoteFor(artifacts, repo, "read", 6 * 3600),
	]);
	const secret = randomHex(24);
	const integrator = integratorFor(env, repo);
	await integrator.registerTask({ id, agent, task, fork: forkName, tokenHash: await sha256(secret), base: trunk.head, allowProtected });
	const context = paths.length > 0 ? await integrator.why(paths) : [];

	return json(
		{
			id,
			token: `rgt.${id}.${secret}`,
			agent,
			task,
			base: trunk.head,
			fork: { name: forkName, remote: forkWrite.url, token: forkWrite.token, cloneUrl: authenticatedUrl(forkWrite) },
			trunk: { remote: trunkRead.url, token: trunkRead.token, branch: trunk.branch, fetchUrl: authenticatedUrl(trunkRead) },
			context,
			submit: {
				method: "POST",
				url: `${origin}/repos/${repo}/submit`,
				authorization: "Bearer <token>",
				body: {
					task: id,
					ref: "<the branch you pushed to your fork>",
					thread: { decision: "<what you decided and why>", rejected: [{ approach: "<what you tried or considered>", why: "<why not>" }] },
				},
			},
			why: `${origin}/repos/${repo}/why?path=<path>`,
		},
		201,
	);
}

function parseThread(value: unknown, task: TaskRow): ThreadRecord {
	if (!value || typeof value !== "object") return fail(422, '"thread" must be an object with a "decision".');
	const input = value as Record<string, unknown>;
	const rejected: Array<{ approach: string; why: string }> = [];
	if (Array.isArray(input.rejected)) {
		for (const entry of input.rejected.slice(0, 10)) {
			if (entry && typeof entry === "object") {
				const item = entry as Record<string, unknown>;
				rejected.push({ approach: text(item.approach, "thread.rejected.approach", 500), why: text(item.why, "thread.rejected.why", 1000) });
			}
		}
	}
	const record: ThreadRecord = {
		agent: task.agent,
		task: task.task,
		decision: text(input.decision, "thread.decision", 4000),
		rejected,
	};
	if (input.session && typeof input.session === "object") {
		const session = input.session as Record<string, unknown>;
		if (typeof session.ref === "string" && /^refs\/[A-Za-z0-9._\/-]{1,180}$/.test(session.ref)) {
			record.session = { repo: task.fork, ref: session.ref };
		}
	}
	if (screenedState(record).length > NOTE_CHAR_BUDGET) {
		return fail(422, `The thread record is too long. Keep the decision and the rejected approaches under ${NOTE_CHAR_BUDGET} characters in total.`);
	}
	return record;
}

/** POST /repos/:repo/submit: queue a pushed branch for verification and landing. */
async function submit(request: Request, env: Env, repo: string, origin: string): Promise<Response> {
	const caller = await identify(request, env, repo);
	await requireRepo(env, repo);
	const body = await readBody(request);
	const integrator = integratorFor(env, repo);

	const taskId = text(body.task, "task", 40);
	const task = caller.role === "task" ? caller.task : await integrator.task(taskId);
	if (!task || task.id !== taskId) return fail(404, `No task "${taskId}" for this token.`);

	// Pin the submission to the commit the ref points at now.
	const requested = text(body.ref, "ref", 300);
	const refs = await listRemoteRefs(await remoteFor(artifactsOf(env), task.fork, "read", 300));
	const ref = [requested, `refs/heads/${requested}`].find((candidate) => refs.has(candidate));
	if (!ref) return fail(422, `"${requested}" does not exist in your fork. Push it first.`, { refs: [...refs.keys()] });
	if (ref.startsWith("refs/heads/regit/")) fail(422, "Refs under regit/ are reserved for the verifier.");
	const head = refs.get(ref) as string;

	const thread = parseThread(body.thread, task);
	let screen: NoteScreen | null = null;
	const ai = clefOf(env);
	if (ai) {
		try {
			screen = await screenNote(ai, thread);
		} catch {
			// The decision model is unavailable. The record goes through unscreened, and the evidence says so.
			screen = null;
		}
		if (screen?.verdict === "weak") {
			return fail(422, "The thread record does not state a decision and a reason for it.", {
				hint: "Say what you chose, why, and what you considered and rejected. Later agents read this before changing the same code.",
				screen,
			});
		}
	}

	const candidate = await integrator.submit({ taskId: task.id, ref, head, thread, screen });
	return json(
		{
			id: candidate.id,
			status: candidate.status,
			head,
			ref,
			quarantined: screen?.verdict === "quarantine" ? "The thread record looks like instructions to its reader. The change will be verified, but the record will not be published." : undefined,
			poll: `${origin}/repos/${repo}/candidates/${candidate.id}`,
		},
		202,
	);
}

/** What an agent should do next, given how its candidate ended. */
function nextStep(status: string, reason: string | null): string | undefined {
	if (status === "landed") return "Nothing. Your change is on trunk.";
	if (status === "queued" || status === "verifying") return "Wait and poll again.";
	switch (reason) {
		case "conflict":
			return "Fetch trunk, merge it into your branch, resolve the conflicts with the related decisions in mind, push, and submit again.";
		case "protected-path":
			return "Leave that file as it is on trunk, or ask the operator for a task that is allowed to change it.";
		case "tests-failed":
			return "Read the test output, fix the change, push, and submit again.";
		case "install-failed":
			return "Dependencies did not install. Fix the manifest or lockfile, push, and submit again.";
		case "empty":
			return "Your branch adds nothing to trunk. Check that you pushed your commits.";
		case "candidate-changed":
			return "The branch moved after you submitted it. Submit again.";
		default:
			return "Submit again. If it keeps failing, tell the operator.";
	}
}

export async function handleApi(request: Request, env: Env): Promise<Response | null> {
	const url = new URL(request.url);
	const parts = url.pathname.split("/").filter(Boolean);
	if (parts[0] !== "repos") return null;
	const method = request.method;

	try {
		if (parts.length === 1) {
			if (method === "POST") return await createRepo(request, env);
			return fail(405, "Use POST /repos to register a repository.");
		}
		const repo = decodeURIComponent(parts[1]);
		if (!REPO_NAME.test(repo)) fail(404, "No such repository.");
		const integrator = integratorFor(env, repo);

		if (parts.length === 2 && method === "GET") {
			await requireAdmin(request, env);
			return json(await requireRepo(env, repo));
		}
		if (parts.length === 3 && (parts[2] === "pause" || parts[2] === "resume") && method === "POST") {
			await requireAdmin(request, env);
			await requireRepo(env, repo);
			await (parts[2] === "pause" ? integrator.pause() : integrator.resume());
			return json(await integrator.status());
		}
		if (parts.length === 3 && parts[2] === "tasks" && method === "POST") {
			return await createTask(request, env, repo, url.origin);
		}
		if (parts.length === 3 && parts[2] === "submit" && method === "POST") {
			return await submit(request, env, repo, url.origin);
		}
		if (parts.length === 3 && parts[2] === "candidates" && method === "GET") {
			await requireAdmin(request, env);
			return json({ candidates: await integrator.candidates(Number(url.searchParams.get("limit")) || 100) });
		}
		if (parts.length === 4 && parts[2] === "candidates" && method === "GET") {
			const caller = await identify(request, env, repo);
			const candidate = await integrator.candidate(parts[3]);
			if (!candidate || (caller.role === "task" && candidate.taskId !== caller.task.id)) {
				return fail(404, "No such candidate.");
			}
			return json({ ...candidate, next: nextStep(candidate.status, candidate.reason) });
		}
		if (parts.length === 3 && parts[2] === "why" && method === "GET") {
			await identify(request, env, repo);
			const paths = url.searchParams.getAll("path").filter(Boolean);
			if (paths.length === 0) fail(422, "Pass at least one ?path=.");
			return json({ paths, decisions: await integrator.why(paths) });
		}
		if (parts.length === 3 && parts[2] === "events" && method === "GET") {
			await requireAdmin(request, env);
			return json({ events: await integrator.events(Number(url.searchParams.get("after")) || 0) });
		}
		return fail(404, "Not found.");
	} catch (error) {
		if (error instanceof HttpError) return json(error.body, error.status);
		const code = (error as { code?: string })?.code;
		if (code === "NOT_FOUND") return json({ error: "The repository does not exist in Artifacts." }, 404);
		if (code === "ALREADY_EXISTS") return json({ error: "A repository with that name already exists in Artifacts." }, 409);
		console.error("regit api error", error);
		return json({ error: "Internal error. The Worker's logs have the details." }, 500);
	}
}
