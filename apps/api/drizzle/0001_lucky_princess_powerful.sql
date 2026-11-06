ALTER TABLE `localities` ADD `region` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `localities` ADD `country` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `localities` ADD `country_code` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `localities` ADD `population` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `localities` ADD `aliases` text DEFAULT '[]' NOT NULL;