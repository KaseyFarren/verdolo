alter table clients add column if not exists quick_note text;
alter table clients add column if not exists awaiting_reply boolean not null default false;

-- old app's frequency values are dynamic ('daily' | 'weekdays' | 'weekly:0'..'weekly:6'),
-- not the fixed daily/weekly/monthly enum this table started with
alter table recurring_templates drop constraint if exists recurring_templates_frequency_check;
