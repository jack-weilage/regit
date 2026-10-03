import type { ToolExecutor } from './types.ts';

export function combineTools(...executors: ToolExecutor[]): ToolExecutor {
	const owners = new Map(
		executors.flatMap((executor) => executor.specs.map((spec) => [spec.name, executor] as const))
	);
	return {
		specs: executors.flatMap((executor) => executor.specs),
		execute(call, signal) {
			const owner = owners.get(call.name);
			if (!owner) throw new Error(`Unknown tool ${call.name}`);
			return owner.execute(call, signal);
		}
	};
}
