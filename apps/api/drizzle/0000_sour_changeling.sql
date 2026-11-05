CREATE TABLE `blocks` (
	`blocker_id` text NOT NULL,
	`blocked_id` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`blocker_id`, `blocked_id`)
);
--> statement-breakpoint
CREATE INDEX `blocks_blocked_idx` ON `blocks` (`blocked_id`);--> statement-breakpoint
CREATE TABLE `conversation_members` (
	`conversation_id` text NOT NULL,
	`user_id` text NOT NULL,
	`joined_at` integer NOT NULL,
	`last_read_at` integer,
	`unread_count` integer DEFAULT 0 NOT NULL,
	`muted` integer DEFAULT false NOT NULL,
	PRIMARY KEY(`conversation_id`, `user_id`)
);
--> statement-breakpoint
CREATE INDEX `members_user_idx` ON `conversation_members` (`user_id`);--> statement-breakpoint
CREATE TABLE `conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`topic_id` text,
	`locality_id` text,
	`last_message_preview` text,
	`last_message_sender_id` text,
	`last_message_at` integer,
	`last_user_message_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `localities` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`parent_id` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `localities_slug_unique` ON `localities` (`slug`);--> statement-breakpoint
CREATE TABLE `magic_links` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`token_hash` text NOT NULL,
	`code_hash` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `magic_links_token_hash_unique` ON `magic_links` (`token_hash`);--> statement-breakpoint
CREATE INDEX `magic_links_email_idx` ON `magic_links` (`email`,`created_at`);--> statement-breakpoint
CREATE TABLE `matches` (
	`id` text PRIMARY KEY NOT NULL,
	`user_a` text NOT NULL,
	`user_b` text NOT NULL,
	`topic_id` text,
	`conversation_id` text NOT NULL,
	`state` text DEFAULT 'active' NOT NULL,
	`expires_at` integer NOT NULL,
	`nudged_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `matches_pair_idx` ON `matches` (`user_a`,`user_b`);--> statement-breakpoint
CREATE INDEX `matches_conversation_idx` ON `matches` (`conversation_id`);--> statement-breakpoint
CREATE INDEX `matches_sweep_idx` ON `matches` (`state`,`created_at`);--> statement-breakpoint
CREATE TABLE `meetup_responses` (
	`meetup_id` text NOT NULL,
	`user_id` text NOT NULL,
	`response` text NOT NULL,
	`did_meet` integer,
	`responded_at` integer NOT NULL,
	PRIMARY KEY(`meetup_id`, `user_id`)
);
--> statement-breakpoint
CREATE TABLE `meetups` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`proposed_by` text NOT NULL,
	`starts_at` integer NOT NULL,
	`ends_at` integer NOT NULL,
	`venue_kind` text NOT NULL,
	`venue_note` text DEFAULT '' NOT NULL,
	`state` text DEFAULT 'proposed' NOT NULL,
	`share_token` text NOT NULL,
	`reminder_sent_at` integer,
	`checkin_sent_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `meetups_share_token_unique` ON `meetups` (`share_token`);--> statement-breakpoint
CREATE INDEX `meetups_conversation_idx` ON `meetups` (`conversation_id`);--> statement-breakpoint
CREATE INDEX `meetups_sweep_idx` ON `meetups` (`state`,`starts_at`);--> statement-breakpoint
CREATE TABLE `people_swipes` (
	`from_user` text NOT NULL,
	`to_user` text NOT NULL,
	`direction` text NOT NULL,
	`via_topic_id` text,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`from_user`, `to_user`)
);
--> statement-breakpoint
CREATE TABLE `profiles` (
	`user_id` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	`bio` text DEFAULT '' NOT NULL,
	`avatar_key` text,
	`role` text NOT NULL,
	`fields` text NOT NULL,
	`looking_for` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `push_tokens` (
	`token` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`platform` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `push_tokens_user_idx` ON `push_tokens` (`user_id`);--> statement-breakpoint
CREATE TABLE `reports` (
	`id` text PRIMARY KEY NOT NULL,
	`reporter_id` text NOT NULL,
	`target_user_id` text NOT NULL,
	`conversation_id` text,
	`message_id` text,
	`reason` text NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	`resolved_at` integer,
	`action` text
);
--> statement-breakpoint
CREATE INDEX `reports_open_idx` ON `reports` (`resolved_at`,`created_at`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `sessions_user_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE TABLE `topic_swipes` (
	`user_id` text NOT NULL,
	`topic_id` text NOT NULL,
	`direction` text NOT NULL,
	`stance` text,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `topic_id`)
);
--> statement-breakpoint
CREATE INDEX `topic_swipes_topic_idx` ON `topic_swipes` (`topic_id`,`direction`);--> statement-breakpoint
CREATE TABLE `topics` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`blurb` text DEFAULT '' NOT NULL,
	`field_tags` text NOT NULL,
	`openers` text NOT NULL,
	`status` text NOT NULL,
	`created_by` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `topics_status_idx` ON `topics` (`status`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`dob` text,
	`verified_institution` integer DEFAULT false NOT NULL,
	`institution_domain` text,
	`city_id` text,
	`campus_id` text,
	`status` text DEFAULT 'active' NOT NULL,
	`onboarded_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE INDEX `users_city_idx` ON `users` (`city_id`,`status`);