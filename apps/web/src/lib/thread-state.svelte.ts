// The thread page component is reused across threads, so anything a person starts in one
// thread lives here, keyed by thread, rather than in the page's own state.
export class ThreadState {
	draft = $state('');
	service = $state<string | null>(null);
	logs = $state<string | null>(null);
	busy = $state<string | null>(null);
	failure = $state<string | null>(null);
	cancelling = $state<string | null>(null);
	updating = $state<{ sha: string; calling: boolean } | null>(null);
}

export function threadStates() {
	const states = new Map<string, ThreadState>();
	return (id: string) => {
		let state = states.get(id);
		if (!state) states.set(id, (state = new ThreadState()));
		return state;
	};
}
