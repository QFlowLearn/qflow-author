import { defineHttpRoute, type HttpHandler } from '../../route.ts';
import Button from '../../../../components/ui/Button.tsx';
import Checkbox from '../../../../components/ui/Checkbox.tsx';
import Select from '../../../../components/ui/Select.tsx';
import NewQuestionPointsPreference from '../../../../components/ui/NewQuestionPointsPreference.tsx';
import { questionPointsInputText } from '../../../question_points.ts';
import {
  type EditorPreferencesFormValues,
  type InstructorDefaults,
  parseEditorPreferencesForm,
} from '../../../instructor_defaults.ts';
import {
  readInstructorDefaults,
  saveEditorPreferences,
} from '../../../services/instructor_defaults.ts';
import { getUserSettings } from '../../../services/user_settings.ts';
import { requireAuthContext } from '../../../tenants.ts';
import type { I18n } from '../../../i18n/messages.ts';

type Data = {
  readonly _tag: 'Saved';
  choiceRichText: boolean;
  instructorDefaults: InstructorDefaults;
  success?: boolean;
} | { readonly _tag: 'RejectedPoints'; readonly form: EditorPreferencesFormValues };

const methods = {
  async GET(ctx) {
    const auth = requireAuthContext(ctx.state);
    const url = ctx.url;
    const success = url.searchParams.get('success') === '1';
    const [settings, instructorDefaults] = await Promise.all([
      getUserSettings(auth.userId),
      readInstructorDefaults(auth),
    ]);
    return ctx.render(
      <EditorSettingsPage
        data={{
          _tag: 'Saved',
          choiceRichText: settings.choiceRichText,
          instructorDefaults,
          success,
        }}
        i18n={ctx.state.i18n}
      />,
    );
  },
  async POST(ctx) {
    const auth = requireAuthContext(ctx.state);
    const form = await ctx.req.formData();
    const parsed = parseEditorPreferencesForm(form, ctx.state.i18n.locale);
    if (parsed._tag === 'InvalidForm') {
      return new Response(ctx.state.i18n.t('settings.editor.invalidDefaults'), { status: 400 });
    }
    if (parsed._tag === 'InvalidPoints') {
      return ctx.render(
        <EditorSettingsPage
          data={{ _tag: 'RejectedPoints', form: parsed.form }}
          i18n={ctx.state.i18n}
        />,
        400,
      );
    }
    await saveEditorPreferences(auth, parsed.preferences);

    const url = ctx.url;
    const redirect = new URL('/settings/editor', url.origin);
    redirect.searchParams.set('success', '1');
    return new Response(null, {
      status: 303,
      headers: { location: redirect.pathname + redirect.search },
    });
  },
} satisfies Readonly<Record<string, HttpHandler>>;
export const settingsEditorPageRoute = defineHttpRoute('/settings/editor', {
  ...methods,
  HEAD: methods.GET,
});

/** Show saved editor policy or retain rejected numeric input without saving other preferences. */
export default function EditorSettingsPage({ data, i18n }: { data: Data; i18n: I18n }) {
  const choiceRichText = data._tag === 'RejectedPoints'
    ? data.form.choiceRichText
    : data.choiceRichText;
  const answerChoiceOrder = data._tag === 'RejectedPoints'
    ? data.form.answerChoiceOrder
    : data.instructorDefaults?.answerChoiceOrder ?? 'question-default';
  const pointText = data._tag === 'RejectedPoints'
    ? data.form.pointText
    : questionPointsInputText(data.instructorDefaults?.maximumScore ?? undefined, i18n.locale);
  return (
    <section class='space-y-6'>
      <div class='space-y-2'>
        <h1 class='text-3xl font-medium'>{i18n.t('settings.editor.title')}</h1>
        <p class='text-sm text-base-content/70'>{i18n.t('settings.editor.subtitle')}</p>
      </div>
      <form class='ds-card ds-card-bordered max-w-xl' method='post'>
        <div class='ds-card-body space-y-4'>
          {data._tag === 'Saved' && data.success && (
            <div class='ds-alert text-sm' role='status'>{i18n.t('settings.editor.saved')}</div>
          )}
          <label class='flex items-center justify-between gap-3'>
            <span>{i18n.t('settings.editor.choiceRichText')}</span>
            <Checkbox
              name='choiceRichText'
              defaultChecked={choiceRichText}
              aria-describedby='choice-rich-text-help'
            />
          </label>
          <p id='choice-rich-text-help' class='text-sm text-base-content/70'>
            {i18n.t('settings.editor.choiceRichTextHelp')}
          </p>
          <div class='space-y-3 border-t border-base-200 pt-4'>
            <h2 class='text-base font-semibold'>{i18n.t('settings.editor.newQuestionDefaults')}</h2>
            <p class='text-sm text-base-content/70'>{i18n.t('settings.editor.defaultsScope')}</p>
            <label for='answer-choice-order' class='block text-sm font-medium'>
              {i18n.t('settings.editor.answerChoiceOrder')}
            </label>
            <Select
              id='answer-choice-order'
              name='answerChoiceOrder'
              defaultValue={answerChoiceOrder}
              aria-describedby='answer-choice-order-help'
            >
              <option value='question-default'>{i18n.t('settings.editor.questionDefault')}</option>
              <option value='authored'>{i18n.t('settings.editor.authoredAnswers')}</option>
              <option value='shuffled'>{i18n.t('settings.editor.shuffledAnswers')}</option>
            </Select>
            <p id='answer-choice-order-help' class='text-sm text-base-content/70'>
              {i18n.t('settings.editor.defaultsHelp')}
            </p>
            <NewQuestionPointsPreference
              value={pointText}
              label={i18n.t('settings.editor.newQuestionPoints')}
              help={i18n.t('settings.editor.pointsScope')}
              unsetHelp={i18n.t('settings.editor.pointsUnset')}
              issue={data._tag === 'RejectedPoints'
                ? i18n.t('settings.editor.pointsInvalid')
                : undefined}
            />
          </div>
        </div>
        <div class='ds-card-actions justify-between border-t border-base-200 px-6 py-4'>
          <Button variant='primary' type='submit'>{i18n.t('settings.editor.save')}</Button>
          <Button variant='ghost' href='/settings'>{i18n.t('settings.editor.back')}</Button>
        </div>
      </form>
    </section>
  );
}
