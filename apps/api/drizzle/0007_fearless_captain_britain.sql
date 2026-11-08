CREATE TABLE `meetup_outcomes` (
	`meetup_id` text NOT NULL,
	`user_id` text NOT NULL,
	`mind_changed` text NOT NULL,
	`ended_up` text NOT NULL,
	`meet_again` text NOT NULL,
	`takeaway` text,
	`takeaway_status` text,
	`language` text DEFAULT 'en' NOT NULL,
	`created_at` integer NOT NULL,
	`reviewed_at` integer,
	PRIMARY KEY(`meetup_id`, `user_id`)
);
--> statement-breakpoint
CREATE INDEX `meetup_outcomes_takeaway_idx` ON `meetup_outcomes` (`takeaway_status`,`created_at`);