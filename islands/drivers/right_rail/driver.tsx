import type { FunctionalComponent } from 'preact';
import { Fragment } from 'preact';
import type { DriverRightRailProps } from './types.ts';
import { useI18n } from '../../../lib/i18n/context.tsx';
import SettingsSection from '../../../components/ui/SettingsSection.tsx';

export const DriverRightRail: FunctionalComponent<DriverRightRailProps> = ({ controls }) => {
  const i18n = useI18n();
  const sections = controls.sections ?? [];
  if (!sections.length) return null;
  const groups = [
    ['answer', 'inspector.answerBehavior'],
    ['scoring', 'driver.rightRail.scoring'],
    ['accessibility', 'inspector.accessibility'],
    ['details', 'inspector.details'],
  ] as const;
  return (
    <>
      {groups.map(([group, label]) => {
        const grouped = sections.filter((section) => section.group === group);
        return grouped.length > 0 && (
          <SettingsSection
            key={group}
            group={group}
            label={i18n.t(label)}
            defaultOpen={group === 'answer' || group === 'scoring'}
          >
            {grouped.map((section) => <Fragment key={section.id}>{section.content}</Fragment>)}
          </SettingsSection>
        );
      })}
    </>
  );
};
