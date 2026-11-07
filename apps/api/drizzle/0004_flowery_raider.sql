CREATE TABLE `device_keys` (
	`public_key` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`retired_at` integer
);
--> statement-breakpoint
CREATE INDEX `device_keys_user_idx` ON `device_keys` (`user_id`);--> statement-breakpoint
ALTER TABLE `conversations` ADD `last_message_envelope` text;--> statement-breakpoint
ALTER TABLE `reports` ADD `evidence` text;--> statement-breakpoint
-- Previews of messages from before encryption were plain text.
UPDATE `conversations` SET `last_message_preview` = NULL WHERE `last_message_sender_id` IS NOT NULL;
