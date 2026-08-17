-- Create project-media bucket (idempotent) with image/video/audio MIME types.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'project-media',
  'project-media',
  false,
  524288000,
  ARRAY[
    'video/mp4',
    'video/webm',
    'video/quicktime',
    'audio/mpeg',
    'audio/mp4',
    'audio/wav',
    'audio/webm',
    'image/png',
    'image/jpeg',
    'image/webp',
    'image/gif',
    'application/octet-stream'
  ]
)
ON CONFLICT (id) DO UPDATE SET
  allowed_mime_types = EXCLUDED.allowed_mime_types,
  file_size_limit = EXCLUDED.file_size_limit;

-- Storage policies: users read/write files under their own user id prefix.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'project_media_select_own'
  ) THEN
    CREATE POLICY project_media_select_own ON storage.objects
      FOR SELECT TO authenticated
      USING (
        bucket_id = 'project-media'
        AND (storage.foldername(name))[1] = auth.uid()::text
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'project_media_insert_own'
  ) THEN
    CREATE POLICY project_media_insert_own ON storage.objects
      FOR INSERT TO authenticated
      WITH CHECK (
        bucket_id = 'project-media'
        AND (storage.foldername(name))[1] = auth.uid()::text
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'project_media_update_own'
  ) THEN
    CREATE POLICY project_media_update_own ON storage.objects
      FOR UPDATE TO authenticated
      USING (
        bucket_id = 'project-media'
        AND (storage.foldername(name))[1] = auth.uid()::text
      )
      WITH CHECK (
        bucket_id = 'project-media'
        AND (storage.foldername(name))[1] = auth.uid()::text
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'project_media_delete_own'
  ) THEN
    CREATE POLICY project_media_delete_own ON storage.objects
      FOR DELETE TO authenticated
      USING (
        bucket_id = 'project-media'
        AND (storage.foldername(name))[1] = auth.uid()::text
      );
  END IF;
END $$;
