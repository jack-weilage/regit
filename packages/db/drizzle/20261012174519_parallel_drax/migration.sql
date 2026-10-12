CREATE TABLE `__new_git_tokens` (
	`id` text PRIMARY KEY,
	`principal_id` text NOT NULL,
	`hash` text NOT NULL UNIQUE,
	`repo` text NOT NULL,
	`label` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`last_used_at` integer
);
--> statement-breakpoint
INSERT INTO `__new_git_tokens`(`id`, `principal_id`, `hash`, `repo`, `label`, `created_at`, `expires_at`, `last_used_at`) SELECT `id`, `principal_id`, `hash`, `repo`, `label`, `created_at`, `expires_at`, `last_used_at` FROM `git_tokens` WHERE `principal_id` IS NOT NULL;--> statement-breakpoint
DROP TABLE `git_tokens`;--> statement-breakpoint
ALTER TABLE `__new_git_tokens` RENAME TO `git_tokens`;--> statement-breakpoint
ALTER TABLE `repos` DROP COLUMN `created_by`;--> statement-breakpoint
ALTER TABLE `repos` DROP COLUMN `creator_principal_id`;