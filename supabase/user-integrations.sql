-- Per-user Akool credentials. RLS keeps each row private to its owner.
CREATE TABLE IF NOT EXISTS public.user_integrations (
  user_id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  akool_api_key text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.user_integrations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_integrations_select_own ON public.user_integrations;
CREATE POLICY user_integrations_select_own
  ON public.user_integrations
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS user_integrations_insert_own ON public.user_integrations;
CREATE POLICY user_integrations_insert_own
  ON public.user_integrations
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS user_integrations_update_own ON public.user_integrations;
CREATE POLICY user_integrations_update_own
  ON public.user_integrations
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS user_integrations_delete_own ON public.user_integrations;
CREATE POLICY user_integrations_delete_own
  ON public.user_integrations
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);
