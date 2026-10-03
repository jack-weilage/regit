import { createSubscriber } from 'svelte/reactivity';

const subscribe = createSubscriber((update) => {
	const timer = setInterval(update, 15_000);
	return () => clearInterval(timer);
});

export const clock = {
	get now() {
		subscribe();
		return Date.now();
	}
};
