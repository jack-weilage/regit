/**
 * Runs the spike routes inside workerd against the stand-in git server.
 *
 * This cannot answer what the spikes ask, which is how the real Artifacts
 * behaves. It proves that the spike code and the git library run in the
 * Workers runtime, so the only unknowns left are Cloudflare's.
 */
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SpikeReport } from "../src/spikes";
import { type GitServer, startGitServer } from "./git-server";
import { TEST_ADMIN_TOKEN, type TestWorker, startWorker } from "./worker-harness";

let server: GitServer;
let worker: TestWorker;

beforeAll(async () => {
	server = await startGitServer({ auth: true });
	worker = await startWorker({ REGIT_FAKE_ARTIFACTS_URL: server.origin });
}, 90_000);

afterAll(async () => {
	await worker?.stop();
	await server?.close();
});

async function run(id: string): Promise<SpikeReport> {
	const response = await worker.fetch(`/spikes/${id}`, { method: "POST" });
	expect(response.status).toBe(200);
	return (await response.json()) as SpikeReport;
}

describe("spike routes in workerd", () => {
	it("refuses a caller without the admin token", async () => {
		const response = await fetch(`${worker.origin}/spikes/notes`, { method: "POST" });
		expect(response.status).toBe(401);
	});

	it("lists the spikes", async () => {
		const response = await fetch(`${worker.origin}/spikes`);
		const body = (await response.json()) as { spikes: Array<{ id: string }> };
		expect(body.spikes.map((spike) => spike.id)).toEqual(["notes", "cas", "land", "forks", "sandbox", "clef"]);
	});

	it("notes: pushes notes and reads them back", async () => {
		const report = await run("notes");
		expect(report, JSON.stringify(report, null, 2)).toMatchObject({ verdict: "pass" });
	});

	it("cas: a stale ref update is rejected", async () => {
		const report = await run("cas");
		expect(report, JSON.stringify(report, null, 2)).toMatchObject({ verdict: "pass" });
		expect(report.details).toMatchObject({ clientRefusesNonFastForward: true });
	});

	it("land: lands from a fork with a read token for trunk and a write token for the fork", async () => {
		const report = await run("land");
		expect(report, JSON.stringify(report, null, 2)).toMatchObject({ verdict: "pass" });
		expect(report.details).toMatchObject({
			readTokenPushBlocked: true,
			warm: { staleCandidate: { landed: false, reason: "trunk-moved" } },
		});
	});

	it("forks: forks are usable at once and the report says which refs they carry", async () => {
		const report = await run("forks");
		expect(report, JSON.stringify(report, null, 2)).toMatchObject({ verdict: "pass" });
		expect(report.details).toMatchObject({
			notesCarriedWithDefaultBranchOnly: false,
			notesCarriedWithAllRefs: true,
		});
	});

	it("cleans up the repositories a spike created, and keeps them when asked", async () => {
		expect(server.repos()).toEqual([]);
		const response = await worker.fetch("/spikes/notes?keep=1", { method: "POST" });
		expect(((await response.json()) as SpikeReport).verdict).toBe("pass");
		expect(server.repos()).toHaveLength(1);
	});

	it("the runner script runs the chosen spikes and writes the results to a file", async () => {
		const out = join(mkdtempSync(join(tmpdir(), "regit-runner-")), "results.json");
		const stdout = await new Promise<string>((resolve, reject) => {
			execFile(
				process.execPath,
				["scripts/spikes.mjs", worker.origin, "--only", "notes,cas", "--out", out],
				{ env: { ...process.env, REGIT_ADMIN_TOKEN: TEST_ADMIN_TOKEN } },
				(error, output, stderr) => (error ? reject(new Error(`${error.message}\n${output}\n${stderr}`)) : resolve(output)),
			);
		});
		expect(stdout).toMatch(/notes\s+… PASS/);
		expect(stdout).toMatch(/cas\s+… PASS/);
		const saved = JSON.parse(readFileSync(out, "utf8")) as { results: SpikeReport[] };
		expect(saved.results.map((report) => report.id)).toEqual(["notes", "cas"]);
	});
});
