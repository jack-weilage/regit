/**
 * regit: a merge service for agents, on Cloudflare Workers and Artifacts.
 *
 * Each agent pushes to its own fork. A change reaches trunk only through the
 * integrator, after its tests pass against the current trunk head, and every
 * landed commit carries the agent threads behind it as git notes.
 *
 * This entry point currently serves the day-one spikes. The control routes
 * (/tasks, /submit, /candidates, /why) arrive with the integrator.
 */
import { type SpikeOptions, describeSpikes, runSpike } from "./spikes";

export { Verifier } from "./verifier";

function json(body: unknown, status = 200): Response {
	return new Response(`${JSON.stringify(body, null, 2)}\n`, {
		status,
		headers: { "content-type": "application/json; charset=utf-8" },
	});
}

/** Constant-time comparison, so the token cannot be guessed one byte at a time. */
async function sameSecret(a: string, b: string): Promise<boolean> {
	const encoder = new TextEncoder();
	const [left, right] = await Promise.all([
		crypto.subtle.digest("SHA-256", encoder.encode(a)),
		crypto.subtle.digest("SHA-256", encoder.encode(b)),
	]);
	const x = new Uint8Array(left);
	const y = new Uint8Array(right);
	let difference = 0;
	for (let index = 0; index < x.length; index++) difference |= x[index] ^ y[index];
	return difference === 0;
}

/**
 * Every route that creates repositories, mints tokens or starts containers
 * requires the admin token. Returns a response when the caller is refused.
 */
async function refuse(request: Request, env: Env): Promise<Response | null> {
	if (!env.REGIT_ADMIN_TOKEN) {
		return json({ error: "REGIT_ADMIN_TOKEN is not set. Run `npx wrangler secret put REGIT_ADMIN_TOKEN`." }, 503);
	}
	const header = request.headers.get("authorization") ?? "";
	const presented = header.startsWith("Bearer ") ? header.slice(7) : "";
	if (!presented || !(await sameSecret(presented, env.REGIT_ADMIN_TOKEN))) {
		return json({ error: "Missing or wrong bearer token." }, 401);
	}
	return null;
}

export default {
	async fetch(request, env): Promise<Response> {
		const url = new URL(request.url);
		const path = url.pathname.replace(/\/+$/, "") || "/";

		if (request.method === "GET" && path === "/") {
			return json({
				name: "regit",
				status: "day-one spikes",
				routes: { "GET /spikes": "list the spikes", "POST /spikes/:id": "run one spike (bearer token required)" },
			});
		}

		if (request.method === "GET" && path === "/spikes") {
			return json({ spikes: describeSpikes() });
		}

		const spike = path.match(/^\/spikes\/([a-z]+)$/);
		if (request.method === "POST" && spike) {
			const refused = await refuse(request, env);
			if (refused) return refused;
			const options: SpikeOptions = {
				importUrl: url.searchParams.get("import") ?? undefined,
				importBranch: url.searchParams.get("branch") ?? undefined,
				install: url.searchParams.get("install") ?? undefined,
				test: url.searchParams.get("test") ?? undefined,
				keep: url.searchParams.get("keep") === "1",
			};
			const report = await runSpike(env, spike[1], options);
			if (!report) return json({ error: `No spike named "${spike[1]}".`, spikes: describeSpikes() }, 404);
			return json(report);
		}

		return json({ error: "Not found." }, 404);
	},
} satisfies ExportedHandler<Env>;
