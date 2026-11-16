CREATE TABLE `meetup_invites` (
	`meetup_id` text NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`meetup_id`, `user_id`)
);
--> statement-breakpoint
ALTER TABLE `meetups` ADD `guests_welcome` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `meetups` ADD `repeat` text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE `meetups` ADD `next_meetup_id` text;--> statement-breakpoint
CREATE INDEX `meetups_series_idx` ON `meetups` (`repeat`,`ends_at`);