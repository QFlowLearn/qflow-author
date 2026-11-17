import Button from '../ui/Button.tsx';
import Input from '../ui/Input.tsx';
import type { I18n } from '../../lib/i18n/messages.ts';
import type { MemberRecord } from '../../lib/services/memberships.ts';

export default function PublicationGrantControl({ member, i18n }: {
  member: Pick<MemberRecord, 'userId' | 'canPublishEditions'>;
  i18n: I18n;
}) {
  return (
    <form method='post' action='/settings/publication-grants'>
      <Input type='hidden' name='action' value={member.canPublishEditions ? 'revoke' : 'grant'} />
      <Input type='hidden' name='userId' value={member.userId} />
      <span class='mr-2'>
        {i18n.t(
          member.canPublishEditions
            ? 'settings.members.publicationGranted'
            : 'settings.members.publicationNotGranted',
        )}
      </span>
      <Button type='submit' size='sm'>
        {i18n.t(
          member.canPublishEditions
            ? 'settings.members.revokePublication'
            : 'settings.members.grantPublication',
        )}
      </Button>
    </form>
  );
}
