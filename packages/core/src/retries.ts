export interface RetryFailure {
	at: number;
	label: string;
	error: string;
}

// Consecutive failures of one piece of work; `next` is when the next attempt starts, null while it runs.
export interface Retry {
	what: string;
	failures: RetryFailure[];
	attempt: number;
	limit: number;
	next: number | null;
}

export interface Failure {
	title: string;
	error: string;
	failures: RetryFailure[];
}
