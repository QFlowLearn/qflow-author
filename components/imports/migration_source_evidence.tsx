import type { MigrationRunRecord } from '../../lib/import/migration_types.ts';
import type { I18n } from '../../lib/i18n/messages.ts';
import type { SourceBlock } from '../../lib/conversion/source_model.ts';

/** Show source evidence for the questions in the current review selection. */
export function SourceEvidencePanel(
  { run, i18n, paged }: {
    run: MigrationRunRecord;
    i18n: I18n;
    paged: boolean;
  },
) {
  const document = run.artifacts.find((artifact) => artifact.kind === 'normalized')?.document;
  const allBlocks = document?.blocks ?? [];
  const visibleEntries = new Set(run.items.map((item) => `package-entry-${item.position}`));
  const blocks = paged && allBlocks.every((block) => block.id.startsWith('package-entry-'))
    ? allBlocks.filter((block) => visibleEntries.has(block.id))
    : allBlocks;
  const uncertainties = document?.uncertainties ?? [];
  return (
    <aside class='min-w-0 space-y-4 lg:sticky lg:top-4' aria-labelledby='source-heading'>
      <div class='rounded-lg border border-base-300 bg-base-100'>
        <div class='border-b border-base-300 p-4'>
          <h2 id='source-heading' class='text-lg font-semibold'>
            {i18n.t('imports.report.sourceEvidence')}
          </h2>
          <p class='mt-1 truncate text-sm text-base-content/60'>{run.sourceFilename}</p>
        </div>
        <div class='max-h-[68vh] space-y-4 overflow-y-auto p-4'>
          {blocks.length
            ? blocks.map((block) => <SourceBlockView key={block.id} block={block} i18n={i18n} />)
            : (
              <p class='text-sm leading-6 text-base-content/65'>
                {i18n.t('imports.report.sourcePackageFallback')}
              </p>
            )}
        </div>
      </div>
      {uncertainties.length > 0 && (
        <div class='rounded-lg border border-warning/50 bg-warning/10 p-4'>
          <h3 class='font-medium'>{i18n.t('imports.report.extractionUncertainty')}</h3>
          <p class='sr-only'>{i18n.t('imports.report.rawDiagnostic')}</p>
          <ul class='mt-2 list-disc space-y-2 pl-5 text-sm leading-5'>
            {uncertainties.map((entry, index) => (
              <li key={`${entry.code}-${index}`}>{entry.message}</li>
            ))}
          </ul>
        </div>
      )}
    </aside>
  );
}

function SourceBlockView({ block, i18n }: { block: SourceBlock; i18n: I18n }) {
  const props = { id: `source-${block.id}`, class: 'scroll-mt-4' };
  if (block.kind === 'heading') {
    return <h3 {...props} class={`${props.class} font-semibold`}>{block.text}</h3>;
  }
  if (block.kind === 'paragraph') {
    return <p {...props} class={`${props.class} text-sm leading-6`}>{block.text}</p>;
  }
  if (block.kind === 'list') {
    return (
      <ol
        {...props}
        class={`${props.class} ${block.ordered ? 'list-decimal' : 'list-disc'} pl-5 text-sm`}
      >
        {block.items.map((item, index) => <li key={`${block.id}-${index}`}>{item}</li>)}
      </ol>
    );
  }
  if (block.kind === 'table') {
    return (
      <div {...props} class={`${props.class} overflow-x-auto`}>
        <table class='ds-table ds-table-xs'>
          <tbody>
            {block.rows.map((row, rowIndex) => (
              <tr key={`${block.id}-row-${rowIndex}`}>
                {row.map((cell, cellIndex) => (
                  <td key={`${block.id}-${rowIndex}-${cellIndex}`}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  if (block.kind === 'image') {
    return (
      <div {...props} class={`${props.class} rounded-md border border-base-300 p-3 text-sm`}>
        {i18n.t('imports.report.image', { value: block.alt || block.source })}
      </div>
    );
  }
  if (block.kind === 'equation') {
    return (
      <pre {...props} class={`${props.class} overflow-x-auto text-sm`}>{block.expression}</pre>
    );
  }
  return (
    <div {...props} class={`${props.class} border-t border-base-300 pt-3 text-xs font-medium`}>
      {i18n.t('imports.report.page', { page: block.page })}
    </div>
  );
}
