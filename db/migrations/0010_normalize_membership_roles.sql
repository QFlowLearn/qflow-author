ALTER TABLE organization_memberships
  ALTER COLUMN role SET DEFAULT 'instructor';

UPDATE organization_memberships
  SET role = 'instructor'
  WHERE role IS NULL OR role = '' OR role = 'member';
