import type { ToolArguments } from '@regit/agent';

export async function containerRun(
	container: Container,
	{ command, timeout_seconds = 120 }: ToolArguments['run'],
	env: Record<string, string>,
	signal?: AbortSignal
) {
	signal?.throwIfAborted();
	if (!Number.isFinite(timeout_seconds) || timeout_seconds <= 0) {
		throw new Error('timeout_seconds must be positive');
	}
	const process = await container.exec(
		// timeout creates a process group; 0 disables its timer. Our deadline
		// also covers background children keeping output open after Bash exits.
		[
			'timeout',
			'0',
			'bash',
			'-c',
			'printf "%s\n" "$PPID" >&2; exec bash -lc "$1" 2>&1',
			'bash',
			command
		],
		{
			cwd: '/workspace',
			env: {
				HOME: '/root',
				MISE_DATA_DIR: '/opt/mise',
				MISE_CACHE_DIR: '/opt/mise/cache',
				SANDBOX_ROOT: '/workspace',
				PORT: '8080',
				...env
			}
		}
	);
	// Report the group from inside the container: local native exec PIDs can
	// belong to the host's namespace rather than the container's namespace.
	const pid = await processGroup(process.stderr);
	const completed = Promise.all([
		boundedOutput(process.stdout),
		process.exitCode,
		boundedOutput(process.stderr)
	]);
	let abort!: () => void;
	let timer!: ReturnType<typeof setTimeout>;
	const interrupted = new Promise<'aborted' | 'timeout'>((resolve) => {
		abort = () => resolve('aborted');
		timer = setTimeout(() => resolve('timeout'), timeout_seconds * 1000);
	});
	signal?.addEventListener('abort', abort, { once: true });
	try {
		if (signal?.aborted) abort();
		const reason = await Promise.race([completed.then(() => 'completed' as const), interrupted]);
		if (reason !== 'completed') {
			// GNU timeout owns the process group. Native kill()/signal only reach
			// its leader, leaving shell children alive and output streams open.
			const kill = await container.exec(['bash', '-c', 'kill -KILL -- "-$1"', 'bash', pid], {
				stdout: 'ignore',
				stderr: 'ignore'
			});
			// The group may already have exited between the deadline and kill.
			await kill.exitCode;
		}
		const [output, code] = await completed;
		signal?.throwIfAborted();
		const status =
			reason === 'timeout' ? `timed out after ${timeout_seconds}s` : `exit code ${code}`;
		return `${status}\n${output}`.trimEnd();
	} finally {
		clearTimeout(timer);
		signal?.removeEventListener('abort', abort);
	}
}

async function processGroup(stream: ReadableStream<Uint8Array> | null) {
	if (!stream) throw new Error('Command process group is unavailable');
	const reader = stream.getReader();
	const decoder = new TextDecoder();
	let line = '';
	try {
		while (!line.includes('\n') && line.length < 32) {
			const { value, done } = await reader.read();
			if (done) break;
			line += decoder.decode(value, { stream: true });
		}
		const pid = line.trim();
		if (!/^[1-9]\d*$/.test(pid)) throw new Error(`Could not start command: ${line}`);
		return pid;
	} finally {
		reader.releaseLock();
	}
}

async function boundedOutput(stream: ReadableStream<Uint8Array> | null) {
	if (!stream) return '';
	const decoder = new TextDecoder();
	const half = 10_000;
	let head = '';
	let tail = '';
	let length = 0;
	function append(text: string) {
		length += text.length;
		const take = Math.min(half - head.length, text.length);
		head += text.slice(0, take);
		tail = (tail + text.slice(take)).slice(-half);
	}
	for await (const chunk of stream) append(decoder.decode(chunk, { stream: true }));
	append(decoder.decode());
	return length <= half * 2
		? head + tail
		: `${head}\n… ${length - half * 2} characters omitted …\n${tail}`;
}
