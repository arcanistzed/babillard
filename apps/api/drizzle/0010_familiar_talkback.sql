CREATE TABLE `mls_key_packages` (
	`id` text PRIMARY KEY NOT NULL,
	`device_id` text NOT NULL,
	`user_id` text NOT NULL,
	`key_package` text NOT NULL,
	`last_resort` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `mls_key_packages_device_idx` ON `mls_key_packages` (`device_id`,`last_resort`);--> statement-breakpoint
ALTER TABLE `device_keys` ADD `mls_signature_key` text;