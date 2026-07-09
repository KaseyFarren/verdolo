-- Cap upload size per bucket, enforced server-side regardless of what the client sends -
-- the client also checks this before uploading so users get instant feedback, but this is
-- the backstop against a bypassed/malicious client.

update storage.buckets set file_size_limit = 5 * 1024 * 1024 where id = 'avatars';        -- 5 MB
update storage.buckets set file_size_limit = 50 * 1024 * 1024 where id = 'client-files';   -- 50 MB
update storage.buckets set file_size_limit = 25 * 1024 * 1024 where id = 'message-attachments'; -- 25 MB
