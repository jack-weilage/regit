ALTER TABLE `repos` ADD `machine` text DEFAULT 'standard-1' NOT NULL;--> statement-breakpoint
ALTER TABLE `toolchain_snapshots` ADD `size` integer;