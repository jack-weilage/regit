CREATE TABLE `repo_members` (
	`repo` text NOT NULL,
	`principal_id` text NOT NULL,
	`role` text NOT NULL,
	CONSTRAINT `repo_members_pk` PRIMARY KEY(`repo`, `principal_id`),
	CONSTRAINT `fk_repo_members_repo_repos_name_fk` FOREIGN KEY (`repo`) REFERENCES `repos`(`name`) ON DELETE CASCADE
);
--> statement-breakpoint
ALTER TABLE `git_tokens` ADD `principal_id` text;--> statement-breakpoint
ALTER TABLE `repos` ADD `creator_principal_id` text;