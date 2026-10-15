import type { ThreadSummary } from '@regit/core';

declare global {
	namespace App {
		interface PageData {
			threadRef?: Pick<ThreadSummary, 'id' | 'number'>;
			archivedOpen?: boolean;
		}
		interface Locals {
			user: { id: string; name: string; email: string };
		}
	}
}

export {};
