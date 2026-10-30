'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import {
  ANSWER_KEYS,
  QUESTION_LANGUAGES,
  QUESTION_LANGUAGE_NAMES,
  type QuestionLanguage,
  type QuestionTranslationView,
  type QuestionView,
} from '@sihl-one/contracts';

import {
  removeTranslation,
  saveTranslation,
  translateQuestion,
  type QuestionState,
} from '@/app/actions/questions';

const INITIAL: QuestionState = { status: 'idle' };

/**
 * The other languages this question is asked in.
 *
 * The draft/approved distinction is the whole point of this panel, so it is
 * stated in words rather than implied by a colour: a draft is machine output
 * nobody has read, and no test may draw on it. Saving the form is the act of
 * approving it, which is why the button says so.
 */
export function TranslationPanel({
  question,
  translationAvailable,
}: {
  question: QuestionView;
  /** False when no provider is configured, which hides the draft button. */
  translationAvailable: boolean;
}) {
  const others = QUESTION_LANGUAGES.filter((language) => language !== question.sourceLanguage);

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-bold">Other languages</h2>
        <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
          The answer and the marks are shared — only the wording changes. A test in a language can
          only draw on questions whose wording there has been approved.
        </p>
      </div>

      {others.map((language) => (
        <LanguageCard
          key={language}
          questionId={question.id}
          language={language}
          wording={question.translations.find((item) => item.language === language)}
          translationAvailable={translationAvailable}
        />
      ))}
    </section>
  );
}

function LanguageCard({
  questionId,
  language,
  wording,
  translationAvailable,
}: {
  questionId: string;
  language: QuestionLanguage;
  wording?: QuestionTranslationView;
  translationAvailable: boolean;
}) {
  const [open, setOpen] = useState(wording?.status === 'DRAFT');
  const [draftState, draft] = useActionState(translateQuestion, INITIAL);
  const [saveState, save] = useActionState(saveTranslation, INITIAL);
  const [removeState, remove] = useActionState(removeTranslation, INITIAL);

  const [values, setValues] = useState({
    text: wording?.text ?? '',
    optionA: wording?.optionA ?? '',
    optionB: wording?.optionB ?? '',
    optionC: wording?.optionC ?? '',
    optionD: wording?.optionD ?? '',
    explanation: wording?.explanation ?? '',
  });
  const bind = (field: keyof typeof values) => ({
    value: values[field],
    onChange: (event: { target: { value: string } }) =>
      setValues((current) => ({ ...current, [field]: event.target.value })),
  });

  const message =
    [draftState, saveState, removeState].find((state) => state.status === 'error')?.message ?? null;

  return (
    <div className="card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold">{QUESTION_LANGUAGE_NAMES[language]}</h3>
          {!wording ? (
            <span className="text-xs text-[var(--color-text-subtle)]">Not written yet</span>
          ) : wording.status === 'DRAFT' ? (
            <span className="rounded-full border border-amber-500/50 px-2 py-0.5 text-[0.6875rem] font-semibold text-amber-600 dark:text-amber-300">
              Draft — nobody has read this
            </span>
          ) : (
            <span className="text-xs text-[var(--color-text-subtle)]">
              Approved{wording.approvedBy ? ` by ${wording.approvedBy}` : ''}
            </span>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          {/*
            Offered only when there is nothing to lose: once a wording is
            approved, re-drafting would replace text a person signed off, and
            the API refuses it. Hiding the button is kinder than the refusal.
          */}
          {translationAvailable && wording?.status !== 'APPROVED' ? (
            <form action={draft}>
              <input type="hidden" name="id" value={questionId} />
              <input type="hidden" name="targetLanguage" value={language} />
              <DraftButton />
            </form>
          ) : null}

          <button
            type="button"
            onClick={() => setOpen((current) => !current)}
            className="btn btn-outline text-xs"
          >
            {open ? 'Close' : wording ? 'Edit' : 'Write it'}
          </button>
        </div>
      </div>

      {wording?.status === 'DRAFT' ? (
        <p className="mt-2 rounded-lg border border-amber-500/40 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-500/10 dark:text-amber-200">
          This came back from the translator. Read it against the original — the answer key was
          written for the source wording — then save it. Until you do, no test can use this
          language.
        </p>
      ) : null}

      {message ? (
        <p role="alert" className="mt-2 text-xs text-danger-500">
          {message}
        </p>
      ) : null}

      {open ? (
        <form action={save} className="mt-3 space-y-3">
          <input type="hidden" name="id" value={questionId} />
          <input type="hidden" name="language" value={language} />

          <div>
            <label className="label" htmlFor={`text-${language}`}>
              Question
            </label>
            <textarea
              id={`text-${language}`}
              name="text"
              rows={3}
              maxLength={2000}
              className="input"
              {...bind('text')}
            />
          </div>

          {ANSWER_KEYS.map((key) => {
            const field = `option${key}` as keyof typeof values;
            return (
              <div key={key} className="flex items-center gap-2">
                <span className="w-4 text-sm font-semibold">{key}</span>
                <input
                  name={field}
                  maxLength={500}
                  className="input flex-1"
                  aria-label={`Option ${key} in ${QUESTION_LANGUAGE_NAMES[language]}`}
                  {...bind(field)}
                />
              </div>
            );
          })}

          <div>
            <label className="label" htmlFor={`explanation-${language}`}>
              Why that is the answer
            </label>
            <textarea
              id={`explanation-${language}`}
              name="explanation"
              rows={2}
              maxLength={2000}
              className="input"
              {...bind('explanation')}
            />
          </div>

          <div className="flex flex-wrap gap-2">
            <SaveButton isDraft={wording?.status === 'DRAFT'} />
          </div>
        </form>
      ) : null}

      {wording ? (
        <form action={remove} className="mt-2">
          <input type="hidden" name="id" value={questionId} />
          <input type="hidden" name="language" value={language} />
          <RemoveButton language={QUESTION_LANGUAGE_NAMES[language]} />
        </form>
      ) : null}
    </div>
  );
}

function DraftButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn btn-outline text-xs" disabled={pending}>
      {pending ? 'Translating…' : 'Draft with Sarvam'}
    </button>
  );
}

function SaveButton({ isDraft }: { isDraft: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn btn-primary text-xs" disabled={pending}>
      {pending ? 'Saving…' : isDraft ? 'I have read this — approve it' : 'Save wording'}
    </button>
  );
}

function RemoveButton({ language }: { language: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      onClick={(event) => {
        if (!window.confirm(`Remove the ${language} wording? The question itself stays.`)) {
          event.preventDefault();
        }
      }}
      className="text-xs font-semibold text-[var(--color-text-muted)] underline underline-offset-2"
    >
      {pending ? 'Removing…' : `Remove ${language}`}
    </button>
  );
}
