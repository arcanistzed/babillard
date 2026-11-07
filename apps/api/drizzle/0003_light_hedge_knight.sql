CREATE TABLE `client_errors` (
	`id` text PRIMARY KEY NOT NULL,
	`message` text NOT NULL,
	`stack` text DEFAULT '' NOT NULL,
	`fatal` integer DEFAULT false NOT NULL,
	`platform` text DEFAULT '' NOT NULL,
	`app_version` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `client_errors_created_idx` ON `client_errors` (`created_at`);--> statement-breakpoint
CREATE TABLE `moderation_log` (
	`id` text PRIMARY KEY NOT NULL,
	`actor` text NOT NULL,
	`action` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`detail` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `moderation_log_created_idx` ON `moderation_log` (`created_at`);--> statement-breakpoint
CREATE INDEX `moderation_log_target_idx` ON `moderation_log` (`target_type`,`target_id`);--> statement-breakpoint
CREATE INDEX `magic_links_created_idx` ON `magic_links` (`created_at`);