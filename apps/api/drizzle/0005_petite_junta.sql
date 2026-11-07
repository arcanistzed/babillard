ALTER TABLE `users` ADD `terms_version` text;--> statement-breakpoint
ALTER TABLE `users` ADD `terms_accepted_at` integer;--> statement-breakpoint
ALTER TABLE `users` ADD `last_active_at` integer;--> statement-breakpoint
ALTER TABLE `users` ADD `inactivity_warned_at` integer;--> statement-breakpoint
CREATE INDEX `users_activity_idx` ON `users` (`status`,`last_active_at`);--> statement-breakpoint
UPDATE `users` SET `last_active_at` = `created_at`;
