CREATE UNIQUE INDEX IF NOT EXISTS organization_memberships_user_unique_idx
  ON organization_memberships (user_id);
