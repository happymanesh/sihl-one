'use client';

import { useActionState, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';
import {
  ANSWER_KEYS,
  QUESTION_LANGUAGES,
  QUESTION_LANGUAGE_NAMES,
  type AnswerKey,
  type QuestionLanguage,
  type QuestionView,
} from '@sihl-one/contracts';

import { createQuestion, updateQuestion, type QuestionState } from '@/app/actions/questions';
import { useSelectResync } from '@/lib/use-select-resync';

const INITIAL: QuestionState = { status: 'idle' };

export interface ProductOption {
  id: string;
  name: string;
  groupName: string | null;
}

export interface SetOption {
  id: string;
  name: string;
  productId: string;
}

/**
 * Write a question, or edit one.
 *
 * One form for both: the fields are identical and a second copy is a second
 * place for them to drift. `question` present means edit.
 *
 * The answer is picked as a radio beside the option it marks rather than as a
 * separate "correct answer" dropdown. A dropdown lets you choose C while
 * looking at B, which is the single most expensive mistake this screen can
 * produce — a whole cohort marked against the wrong key.
 *
 * Every field is controlled, so a refused save hands the work back rather
 * than blanking it.
 */
export function QuestionForm({
  products,
  sets,
  question,
}: {
  products: ProductOption[];
  sets: SetOption[];
  question?: QuestionView;
}) {
  const [state, action] = useActionState(question ? updateQuestion : createQuestion, INITIAL);

  const source = question?.translations.find(
    (wording) => wording.language === question.sourceLanguage,
  );

  const [values, setValues] = useState({
    productId: question?.product.id ?? '',
    questionSetId: question?.questionSet?.id ?? '',
    sourceLanguage: question?.sourceLanguage ?? 'EN',
    marks: String(question?.marks ?? 1),
    negativeMarks: String(question?.negativeMarks ?? 0),
    text: source?.text ?? '',
    optionA: source?.optionA ?? '',
    optionB: source?.optionB ?? '',
    optionC: source?.optionC ?? '',
    optionD: source?.optionD ?? '',
    explanation: source?.explanation ?? '',
  });
  const [correct, setCorrect] = useState<AnswerKey | ''>(question?.correctAnswer ?? '');

  const bind = (field: keyof typeof values) => ({
    value: values[field],
    onChange: (event: { target: { value: string } }) =>
      setValues((current) => ({ ...current, [field]: event.target.value })),
  });

  // Only sets filed under the chosen product: the API refuses the rest, and
  // offering them invites an error the person cannot see coming.
  const setsForProduct = sets.filter((set) => set.productId === values.productId);

  // React resets the form after the action returns, and a controlled select
  // does not come back on its own. Without this the product reads as unchosen
  // while the state still holds it.
  const form = useRef<HTMLFormElement>(null);
  useSelectResync(form, {
    productId: values.productId,
    questionSetId: values.questionSetId,
  });

  return (
    <form ref={form} action={action} className="card space-y-5 p-5" noValidate>
      {question ? <input type="hidden" name="id" value={question.id} /> : null}
      <input type="hidden" name="sourceLanguage" value={values.sourceLanguage} />
      <input type="hidden" name="correctAnswer" value={correct} />

      {state.status === 'error' && state.message ? (
        <p
          role="alert"
          className="rounded-lg border border-danger-500/40 bg-danger-50 px-3 py-2 text-sm text-danger-600 dark:bg-danger-500/15"
        >
          {state.message}
        </p>
      ) : null}
      {state.status === 'success' && state.message ? (
        <p
          role="status"
          className="rounded-lg border border-teal-500/40 bg-teal-50 px-3 py-2 text-sm text-teal-700 dark:bg-teal-500/15 dark:text-teal-200"
        >
          {state.message}
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Product" name="productId" errors={state.errors?.productId} required>
          <select
            id="productId"
            name="productId"
            className="input"
            aria-invalid={Boolean(state.errors?.productId)}
            value={values.productId}
            onChange={(event) =>
              // Changing product orphans the set, so clear it rather than
              // posting a pair the API will reject.
              setValues((current) => ({
                ...current,
                productId: event.target.value,
                questionSetId: '',
              }))
            }
          >
            <option value="">Choose a product</option>
            {products.map((product) => (
              <option key={product.id} value={product.id}>
                {product.groupName ? `${product.groupName} › ` : ''}
                {product.name}
              </option>
            ))}
          </select>
        </Field>

        <Field
          label="Set"
          name="questionSetId"
          errors={state.errors?.questionSetId}
          hint="Optional. A named group inside the product, such as “AML — basics”."
        >
          <select
            id="questionSetId"
            name="questionSetId"
            className="input"
            disabled={!values.productId}
            {...bind('questionSetId')}
          >
            <option value="">No set</option>
            {setsForProduct.map((set) => (
              <option key={set.id} value={set.id}>
                {set.name}
              </option>
            ))}
          </select>
        </Field>
      </div>

      {!question ? (
        <Field
          label="Written in"
          name="sourceLanguage"
          hint="Other languages are added afterwards, from the question’s own page."
        >
          <select
            id="sourceLanguage"
            className="input sm:max-w-xs"
            value={values.sourceLanguage}
            onChange={(event) =>
              setValues((current) => ({
                ...current,
                sourceLanguage: event.target.value as QuestionLanguage,
              }))
            }
          >
            {QUESTION_LANGUAGES.map((language) => (
              <option key={language} value={language}>
                {QUESTION_LANGUAGE_NAMES[language]}
              </option>
            ))}
          </select>
        </Field>
      ) : null}

      <Field label="Question" name="text" errors={state.errors?.text} required>
        <textarea
          id="text"
          name="text"
          rows={3}
          maxLength={2000}
          className="input"
          placeholder="A client refuses to provide proof of address at account opening. What must the rep do?"
          aria-invalid={Boolean(state.errors?.text)}
          {...bind('text')}
        />
      </Field>

      <fieldset className="space-y-2">
        <legend className="label">
          Options <span className="text-danger-500">*</span>
        </legend>
        <p className="text-xs text-[var(--color-text-subtle)]">
          Tick the circle beside the correct one. The position is what is stored, so every
          translation shares the same answer.
        </p>

        {ANSWER_KEYS.map((key) => {
          const field = `option${key}` as keyof typeof values;
          return (
            <div key={key} className="flex items-start gap-2">
              <label className="mt-2 flex items-center gap-1.5 text-sm font-semibold">
                <input
                  type="radio"
                  name="correctAnswerRadio"
                  checked={correct === key}
                  onChange={() => setCorrect(key)}
                  className="h-4 w-4 accent-teal-600"
                  aria-label={`Option ${key} is correct`}
                />
                {key}
              </label>
              <input
                name={field}
                maxLength={500}
                className="input flex-1"
                aria-label={`Option ${key}`}
                aria-invalid={Boolean(state.errors?.[field])}
                {...bind(field)}
              />
            </div>
          );
        })}
        {correct === '' ? (
          <p className="text-xs text-[var(--color-text-subtle)]">No option marked correct yet.</p>
        ) : null}
      </fieldset>

      <Field
        label="Why that is the answer"
        name="explanation"
        errors={state.errors?.explanation}
        hint="Optional. Shown after marking, so a wrong answer teaches something."
      >
        <textarea
          id="explanation"
          name="explanation"
          rows={2}
          maxLength={2000}
          className="input"
          {...bind('explanation')}
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Marks" name="marks" errors={state.errors?.marks} required>
          <input
            id="marks"
            name="marks"
            type="number"
            min="0.25"
            max="100"
            step="0.25"
            className="input"
            aria-invalid={Boolean(state.errors?.marks)}
            {...bind('marks')}
          />
        </Field>
        <Field
          label="Deducted if wrong"
          name="negativeMarks"
          errors={state.errors?.negativeMarks}
          hint="A positive number. Leave at 0 for no negative marking."
        >
          <input
            id="negativeMarks"
            name="negativeMarks"
            type="number"
            min="0"
            max="100"
            step="0.25"
            className="input"
            aria-invalid={Boolean(state.errors?.negativeMarks)}
            {...bind('negativeMarks')}
          />
        </Field>
      </div>

      {question && question.usedInTests > 0 ? (
        <p className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-3 py-2 text-xs text-[var(--color-text-muted)]">
          This question is in {question.usedInTests} published test
          {question.usedInTests === 1 ? '' : 's'}. Saving changes what future tests ask — the ones
          already sat keep their own copy, so no past result moves.
        </p>
      ) : null}

      <Submit editing={Boolean(question)} />
    </form>
  );
}

function Field({
  label,
  name,
  errors,
  required,
  hint,
  children,
}: {
  label: string;
  name: string;
  errors?: string[];
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="label" htmlFor={name}>
        {label} {required ? <span className="text-danger-500">*</span> : null}
      </label>
      {children}
      {hint ? <p className="mt-1 text-xs text-[var(--color-text-subtle)]">{hint}</p> : null}
      {errors ? <p className="mt-1 text-xs text-danger-500">{errors[0]}</p> : null}
    </div>
  );
}

function Submit({ editing }: { editing: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn btn-primary" disabled={pending}>
      {pending ? 'Saving…' : editing ? 'Save changes' : 'Add to the bank'}
    </button>
  );
}
