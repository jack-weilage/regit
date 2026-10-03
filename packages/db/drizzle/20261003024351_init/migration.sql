CREATE TABLE `repos` (
	`name` text PRIMARY KEY,
	`source` text,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `toolchain_snapshots` (
	`repo` text PRIMARY KEY,
	`snapshot_id` text NOT NULL,
	`key` text NOT NULL,
	`image` text NOT NULL,
	`created_at` integer NOT NULL
);
