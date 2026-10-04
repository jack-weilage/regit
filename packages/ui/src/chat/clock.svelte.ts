import { createSubscriber } from 'svelte/reactivity';

function ticking(interval: number) {
	const subscribe = createSubscriber((update) => {
		const timer = setInterval(update, interval);
		return () => clearInterval(timer);
	});
	return {
		get now() {
			subscribe();
			return Date.now();
		}
	};
}

export const clock = ticking(15_000);

export const stopwatch = ticking(1000);
