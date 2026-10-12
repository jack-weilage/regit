/**
 * regit: a merge service for agents, on Cloudflare Workers and Artifacts.
 *
 * Each agent pushes to its own fork. A change reaches trunk only through the
 * integrator, after its tests pass against the current trunk head, and every
 * landed commit carries the agent threads behind it as git notes.
 */
import { handleApi, isAdmin, json } from "./api";
import { type SpikeOptions, describeSpikes, runSpike } from "./spikes";

export { Integrator } from "./integrator";
export { Verifier } from "./verifier";

const ROUTES = {
	"POST /repos": "register a trunk repository (admin)",
	"GET /repos/:repo": "trunk head and queue counts (admin)",
	"POST /repos/:repo/tasks": "fork trunk for an agent and return its tokens (admin)",
	"POST /repos/:repo/submit": "queue a pushed branch for verification and landing (task token)",
	"GET /repos/:repo/candidates/:id": "the outcome of a submission (task token)",
	"GET /repos/:repo/candidates": "every submission (admin)",
	"GET /repos/:repo/why?path=": "decisions recorded against a path (task token)",
	"GET /repos/:repo/events?after=": "the event feed (admin)",
	"POST /repos/:repo/pause": "stop starting verification rounds; submissions keep queueing (admin)",
	"POST /repos/:repo/resume": "start again (admin)",
	"GET /spikes": "list the day-one spikes",
	"POST /spikes/:id": "run one spike (admin)",
};

export default {
	async fetch(request, env): Promise<Response> {
		const url = new URL(request.url);
		const path = url.pathname.replace(/\/+$/, "") || "/";

		if (request.method === "GET" && path === "/") {
			return json({ name: "regit", routes: ROUTES });
		}

		const api = await handleApi(request, env);
		if (api) return api;

		if (request.method === "GET" && path === "/spikes") {
			return json({ spikes: describeSpikes() });
		}

		const spike = path.match(/^\/spikes\/([a-z]+)$/);
		if (request.method === "POST" && spike) {
			if (!env.REGIT_ADMIN_TOKEN) {
				return json({ error: "REGIT_ADMIN_TOKEN is not set on this Worker." }, 503);
			}
			if (!(await isAdmin(request, env))) {
				return json({ error: "The admin token is required." }, 401);
			}
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
