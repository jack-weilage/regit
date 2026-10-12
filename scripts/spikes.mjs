#!/usr/bin/env node
/**
 * Run the day-one spikes against a deployed regit Worker and save the results.
 *
 *   node scripts/spikes.mjs https://regit.<subdomain>.workers.dev
 *
 * The admin token comes from the REGIT_ADMIN_TOKEN environment variable, or
 * from a `.secrets` file in the current directory (`REGIT_ADMIN_TOKEN=...`).
 *
 * Options:
 *   --only notes,land        run only these spikes
 *   --import <https url>     use this repository as trunk instead of a small seeded one
 *   --branch <name>          branch to import
 *   --install "<command>"    sandbox spike: install command, for example "npm ci"
 *   --test "<command>"       sandbox spike: test command, for example "npx vitest run"
 *   --keep                   leave the repositories the spikes create in place
 *   --out <file>             where to write the results (default spike-results.json)
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const origin = args.find((arg) => /^https?:\/\//.test(arg))?.replace(/\/+$/, "");
const option = (name) => {
	const index = args.indexOf(`--${name}`);
	return index === -1 ? undefined : args[index + 1];
};

function adminToken() {
	if (process.env.REGIT_ADMIN_TOKEN) return process.env.REGIT_ADMIN_TOKEN;
	if (!existsSync(".secrets")) return undefined;
	const line = readFileSync(".secrets", "utf8")
		.split("\n")
		.find((entry) => entry.startsWith("REGIT_ADMIN_TOKEN="));
	return line?.slice("REGIT_ADMIN_TOKEN=".length).trim();
}
const token = adminToken();

if (!origin || !token) {
	console.error("Usage: node scripts/spikes.mjs https://regit.<subdomain>.workers.dev");
	console.error("Set REGIT_ADMIN_TOKEN, or put REGIT_ADMIN_TOKEN=... in a .secrets file here.");
	process.exit(2);
}

const listing = await fetch(`${origin}/spikes`).then((response) => response.json());
const only = option("only")?.split(",");
const spikes = listing.spikes.filter((spike) => !only || only.includes(spike.id));

const query = new URLSearchParams();
if (option("import")) query.set("import", option("import"));
if (option("branch")) query.set("branch", option("branch"));
if (option("install")) query.set("install", option("install"));
if (option("test")) query.set("test", option("test"));
if (args.includes("--keep")) query.set("keep", "1");

const results = [];
for (const spike of spikes) {
	process.stdout.write(`${spike.id.padEnd(8)} … `);
	const started = Date.now();
	let report;
	try {
		const response = await fetch(`${origin}/spikes/${spike.id}?${query}`, {
			method: "POST",
			headers: { authorization: `Bearer ${token}` },
		});
		const text = await response.text();
		try {
			report = JSON.parse(text);
		} catch {
			report = { id: spike.id, verdict: "error", summary: `HTTP ${response.status}: ${text.slice(0, 300)}` };
		}
		if (!report.verdict) {
			report = { id: spike.id, verdict: "error", summary: `HTTP ${response.status}: ${JSON.stringify(report)}` };
		}
	} catch (error) {
		report = { id: spike.id, verdict: "error", summary: `Request failed: ${error}` };
	}
	report.clientMs = Date.now() - started;
	results.push(report);
	console.log(`${report.verdict.toUpperCase().padEnd(5)} ${report.summary}`);
}

const out = option("out") ?? "spike-results.json";
writeFileSync(out, `${JSON.stringify({ origin, ranAt: new Date().toISOString(), results }, null, 2)}\n`);
console.log(`\nFull results written to ${out}`);
process.exit(results.every((report) => report.verdict === "pass") ? 0 : 1);
