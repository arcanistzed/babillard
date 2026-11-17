ALTER TABLE `meetups` ADD `announced_state` text;--> statement-breakpoint
ALTER TABLE `meetups` ADD `announced_at` integer;--> statement-breakpoint
-- Meetups confirmed before this change were announced when they confirmed, so the chat already knows.
UPDATE `meetups` SET `announced_state` = 'confirmed', `announced_at` = `created_at` WHERE `state` = 'confirmed';
