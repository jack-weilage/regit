declare global {
	namespace App {
		interface Locals {
			user: { name: string; email: string };
		}
	}
}

export {};
