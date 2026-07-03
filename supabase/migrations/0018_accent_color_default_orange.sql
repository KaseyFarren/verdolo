-- Rebrand: new orgs should default to the brand's burnt-orange accent instead of the old
-- generic purple. Existing orgs keep whatever accent_color they've already customized —
-- this only changes the column default for future signups.
alter table orgs alter column accent_color set default '#dd6b2c';
