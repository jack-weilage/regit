CREATE TABLE `git_tokens` (
	`id` text PRIMARY KEY,
	`hash` text NOT NULL UNIQUE,
	`repo` text NOT NULL,
	`scope` text NOT NULL,
	`label` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`last_used_at` integer
);
