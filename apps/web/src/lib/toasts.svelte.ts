import { createContext } from 'svelte';

export interface ToastMessage {
	text: string;
	code?: string;
	action?: { label: string; onclick: () => void };
}

export class Toasts {
	current = $state<(ToastMessage & { id: number }) | null>(null);
	#next = 0;

	show(message: ToastMessage) {
		this.current = { ...message, id: this.#next++ };
	}

	dismiss() {
		this.current = null;
	}
}

export const [getToasts, setToasts] = createContext<Toasts>();
