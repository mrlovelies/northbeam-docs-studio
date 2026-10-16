CREATE TABLE `article_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`article_id` text NOT NULL,
	`version_number` integer NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`tags` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`article_id`) REFERENCES `articles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `article_versions_article_version_idx` ON `article_versions` (`article_id`,`version_number`);--> statement-breakpoint
CREATE UNIQUE INDEX `article_versions_article_version_unq` ON `article_versions` (`article_id`,`version_number`);--> statement-breakpoint
CREATE TABLE `articles` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`draft_title` text NOT NULL,
	`draft_body` text NOT NULL,
	`draft_tags` text NOT NULL,
	`draft_version` integer DEFAULT 1 NOT NULL,
	`current_published_version_id` text,
	`published_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`current_published_version_id`) REFERENCES `article_versions`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "articles_status_values" CHECK("articles"."status" in ('draft', 'published', 'unpublished')),
	CONSTRAINT "articles_published_has_pointer" CHECK("articles"."status" <> 'published' or "articles"."current_published_version_id" is not null)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `articles_slug_unique` ON `articles` (`slug`);