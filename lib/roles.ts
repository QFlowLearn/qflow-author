const ROLES = ['owner', 'admin', 'instructor', 'teaching_assistant'] as const;
export type Role = typeof ROLES[number];

const ROLE_CAPABILITIES = {
  owner: ['manage_workspace', 'manage_members', 'manage_content', 'view_content'],
  admin: ['manage_members', 'manage_content', 'view_content'],
  instructor: ['manage_content', 'view_content'],
  teaching_assistant: ['view_content'],
} as const;

export type Capability = typeof ROLE_CAPABILITIES[Role][number];

const ROLE_RANK: Record<Role, number> = {
  teaching_assistant: 1,
  instructor: 2,
  admin: 3,
  owner: 4,
};

export function parseRole(value: string | null | undefined): Role | null {
  if (!value) return null;
  const normalized = value.trim();
  if (normalized === 'member') return 'instructor';
  if (normalized === 'teaching assistant') return 'teaching_assistant';
  if (
    normalized === 'owner' || normalized === 'admin' || normalized === 'instructor' ||
    normalized === 'teaching_assistant'
  ) {
    return normalized;
  }
  return null;
}

export function roleAtLeast(role: Role, minimum: Role): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minimum];
}

export function hasCapability(role: Role, capability: Capability): boolean {
  const caps = ROLE_CAPABILITIES[role] as readonly Capability[];
  return caps.includes(capability);
}
