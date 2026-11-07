ALTER TABLE `conversations` ADD `last_message_preview_fr` text;--> statement-breakpoint
ALTER TABLE `topics` ADD `fr` text;--> statement-breakpoint
ALTER TABLE `users` ADD `language` text DEFAULT 'en' NOT NULL;