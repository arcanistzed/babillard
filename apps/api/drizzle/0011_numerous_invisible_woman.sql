CREATE TABLE `mls_history` (
	`user_id` text NOT NULL,
	`conversation_id` text NOT NULL,
	`seq` integer NOT NULL,
	`key_id` text NOT NULL,
	`entry` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `conversation_id`, `seq`)
);
--> statement-breakpoint
CREATE TABLE `mls_history_keys` (
	`user_id` text PRIMARY KEY NOT NULL,
	`key_id` text NOT NULL,
	`created_at` integer NOT NULL
);
