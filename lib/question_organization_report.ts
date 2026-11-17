import type { I18n } from './i18n/messages.ts';
import type { OrganizationReport } from './services/question_organization_report.ts';

/** Format a localized, forwardable record without question text or internal provider settings. */
export function buildOrganizationReport(
  report: OrganizationReport,
  i18n: I18n,
  generatedAt: Date,
): string {
  const cell = (value: string) =>
    value.replace(/[\\`*_{}\[\]<>#|]/g, '\\$&').replace(/[\r\n]+/g, ' ');
  const label = (key: string) => cell(i18n.t(`items.organization.report.${key}`));
  const number = (value: number) => i18n.formatNumber(value);
  const lines = [
    `# ${label('title')}`,
    '',
    `- ${label('collection')}: ${cell(report.collection)}`,
    `- ${label('vocabulary')}: ${cell(report.vocabulary)}`,
    `- ${label('status')}: ${cell(i18n.t(`items.organization.state.${report.state}`))}`,
    `- ${label('started')}: ${report.startedAt.toISOString()}`,
    `- ${label('generated')}: ${generatedAt.toISOString()}`,
    `- ${label('run')}: ${report.id}`,
    '',
    i18n.t('items.organization.report.scope'),
    '',
    `## ${label('outcomes')}`,
    '',
    `| ${label('outcome')} | ${label('questions')} |`,
    '| --- | ---: |',
    `| ${label('total')} | ${number(report.counts.reduce((sum, row) => sum + row.count, 0))} |`,
    ...report.counts.map((row) =>
      `| ${cell(i18n.t(`items.organization.state.${row.state}`))} | ${number(row.count)} |`
    ),
    '',
    `## ${label('topics')}`,
    '',
    i18n.t('items.organization.report.topicScope'),
    '',
    `| ${label('subject')} | ${label('topic')} | ${label('source')} | ${label('automatic')} | ${
      label('preserved')
    } | ${label('total')} |`,
    '| --- | --- | ---: | ---: | ---: | ---: |',
    ...report.topics.map((topic) =>
      `| ${cell(topic.subject)} | ${cell(topic.label)} | ${number(topic.source)} | ${
        number(topic.clef)
      } | ${number(topic.preserved)} | ${number(topic.source + topic.clef + topic.preserved)} |`
    ),
    '',
  ];
  if (report.topics.length === 0) lines.push(i18n.t('items.organization.report.noTopics'), '');
  return lines.join('\n');
}
