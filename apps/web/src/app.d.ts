import type { ThreadSummary } from '@regit/core';

declare global {
	namespace App {
		interface PageData {
			threadRef?: Pick<ThreadSummary, 'id' | 'number'>;
		}
		interface Locals {
			user: { id: string; name: string; email: string };
		}
	}
}

export {};
