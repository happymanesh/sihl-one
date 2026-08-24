'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  changeLeadStatusSchema,
  verifyLeadMobileSchema,
  convertLeadSchema,
  createActivitySchema,
  createLeadSchema,
  updateLeadSchema,
  type ProductInterest,
} from '@sihl-one/contracts';

import { ApiError, apiFetch } from '@/lib/api';

export interface ActionState {
  status: 'idle' | 'success' | 'error';
  message?: string;
  errors?: Record<string, string[]>;
}

/** Turns a Zod failure or an ApiError into the one shape every form renders. */
function toErrorState(error: unknown, fallback: string): ActionState {
  if (error instanceof ApiError) {
    return {
      status: 'error',
      message: error.problem.detail ?? error.problem.title,
      errors: error.fieldErrors,
    };
  }
  return { status: 'error', message: fallback };
}

function zodErrors(issues: Array<{ path: PropertyKey[]; message: string }>) {
  const errors: Record<string, string[]> = {};
  for (const issue of issues) {
    (errors[issue.path.join('.') || '_'] ??= []).push(issue.message);
  }
  return errors;
}

/**
 * Reads the optional client profile out of the form.
 *
 * Returns undefined when the section was left untouched, which the API treats
 * as "this request says nothing about the profile" rather than "clear it" — so
 * a rep correcting a misspelt surname cannot wipe the income and family
 * somebody else spent weeks gathering.
 *
 * Family rows are read positionally: the five controls in each row post under
 * the same names, so the nth relation belongs with the nth name. A row whose
 * fields are all blank is dropped rather than saved as an empty relative.
 */
function readProfile(formData: FormData) {
  const text = (key: string) => {
    const value = formData.get(`profile.${key}`);
    const trimmed = typeof value === 'string' ? value.trim() : '';
    return trimmed || undefined;
  };

  const relations = formData.getAll('family.relation').map(String);
  const names = formData.getAll('family.name').map(String);
  const occupations = formData.getAll('family.occupation').map(String);
  const locations = formData.getAll('family.location').map(String);
  const statuses = formData.getAll('family.maritalStatus').map(String);

  const familyMembers = relations
    .map((relation, index) => ({
      relation,
      name: names[index]?.trim() || undefined,
      occupation: occupations[index]?.trim() || undefined,
      location: locations[index]?.trim() || undefined,
      maritalStatus: statuses[index]?.trim() || undefined,
    }))
    .filter((member) => member.name || member.occupation || member.location || member.maritalStatus);

  const investments = formData.getAll('profile.existingInvestments').map(String);

  const profile = {
    occupation: text('occupation'),
    companyName: text('companyName'),
    designation: text('designation'),
    riskCategory: text('riskCategory'),
    monthlyIncome: text('monthlyIncome'),
    annualIncomeBand: text('annualIncomeBand'),
    monthlySip: text('monthlySip'),
    monthlyEmi: text('monthlyEmi'),
    investmentGoal: text('investmentGoal'),
    existingInvestments: investments.length ? investments : undefined,
    insuranceCover: text('insuranceCover'),
    mediclaimBand: text('mediclaimBand'),
    otherInvestments: text('otherInvestments'),
    familyMembers: familyMembers.length ? familyMembers : undefined,
  };

  const touched = Object.values(profile).some((value) => value !== undefined);
  return touched ? profile : undefined;
}

/**
 * Saves the client profile on an existing lead.
 *
 * Separate from a general lead edit, which the web app does not offer at all
 * today. The profile is the part that genuinely accrues over time — occupation
 * this week, income next month, a daughter's college the month after — so it
 * gets its own save rather than waiting for an edit screen to exist.
 */
export async function updateLeadProfile(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const leadId = String(formData.get('leadId'));
  const profile = readProfile(formData);

  const parsed = updateLeadSchema.safeParse({
    // An untouched section clears nothing; an emptied one sends explicit blanks.
    profile: profile ?? {},
  });

  if (!parsed.success) {
    return {
      status: 'error',
      message: 'Please correct the highlighted fields.',
      errors: zodErrors(parsed.error.issues),
    };
  }

  try {
    await apiFetch(`/leads/${leadId}`, { method: 'PATCH', body: parsed.data });
  } catch (error) {
    return toErrorState(error, 'The details could not be saved.');
  }

  revalidatePath(`/leads/${leadId}`);
  return { status: 'success', message: 'Saved.' };
}

/**
 * Changes the products a lead is interested in.
 *
 * Its own action rather than part of a general lead edit, which the web app
 * still does not offer. This is the field that genuinely changes mid-journey:
 * a client asks about a second product on the third call, and until now that
 * could only be recorded against the interaction — leaving the lead itself
 * invisible to a filter for that product.
 */
export async function updateLeadProducts(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const leadId = String(formData.get('leadId'));

  // An empty selection is a real answer, not a missing one. The hidden marker
  // distinguishes "the rep unticked everything" from "the form never carried
  // this field", which would otherwise look identical.
  const touched = formData.get('productsTouched') === '1';
  if (!touched) return { status: 'idle' };

  const parsed = updateLeadSchema.safeParse({
    productInterest: formData.getAll('productInterest').map(String),
  });

  if (!parsed.success) {
    return {
      status: 'error',
      message: parsed.error.issues[0]?.message ?? 'That selection could not be saved.',
    };
  }

  try {
    await apiFetch(`/leads/${leadId}`, { method: 'PATCH', body: parsed.data });
  } catch (error) {
    return toErrorState(error, 'The products could not be saved.');
  }

  revalidatePath(`/leads/${leadId}`);
  revalidatePath('/leads');
  return { status: 'success', message: 'Saved.' };
}

export async function createLead(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const estimatedValue = formData.get('estimatedValue');

  const parsed = createLeadSchema.safeParse({
    firstName: formData.get('firstName'),
    lastName: formData.get('lastName') || undefined,
    mobile: formData.get('mobile'),
    email: formData.get('email') || undefined,
    pan: formData.get('pan') || undefined,
    city: formData.get('city') || undefined,
    state: formData.get('state') || undefined,
    source: formData.get('source'),
    priority: formData.get('priority') || 'MEDIUM',
    productInterest: formData.getAll('productInterest') as ProductInterest[],
    estimatedValue: estimatedValue ? Number(estimatedValue) : undefined,
    ownerId: formData.get('ownerId') || undefined,
    notes: formData.get('notes') || undefined,
    profile: readProfile(formData),
  });

  if (!parsed.success) {
    return {
      status: 'error',
      message: 'Please correct the highlighted fields.',
      errors: zodErrors(parsed.error.issues),
    };
  }

  let created: { id: string };
  try {
    created = await apiFetch<{ id: string }>('/leads', { method: 'POST', body: parsed.data });
  } catch (error) {
    return toErrorState(error, 'The lead could not be created.');
  }

  revalidatePath('/leads');
  // Outside the try/catch: redirect() signals by throwing, and catching it here
  // would surface a successful save as a failure.
  redirect(`/leads/${created.id}`);
}

export async function changeLeadStatus(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const leadId = String(formData.get('leadId'));
  const followUp = formData.get('nextFollowUpAt');

  const parsed = changeLeadStatusSchema.safeParse({
    status: formData.get('status'),
    lostReason: formData.get('lostReason') || undefined,
    note: formData.get('note') || undefined,
    nextFollowUpAt: followUp ? new Date(String(followUp)) : undefined,
  });

  if (!parsed.success) {
    return {
      status: 'error',
      message: 'Please correct the highlighted fields.',
      errors: zodErrors(parsed.error.issues),
    };
  }

  try {
    await apiFetch(`/leads/${leadId}/status`, {
      method: 'POST',
      body: {
        ...parsed.data,
        nextFollowUpAt: parsed.data.nextFollowUpAt?.toISOString(),
      },
    });
  } catch (error) {
    return toErrorState(error, 'The status could not be changed.');
  }

  revalidatePath(`/leads/${leadId}`);
  revalidatePath('/leads');
  return { status: 'success', message: 'Status updated.' };
}

export async function verifyLeadMobile(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const leadId = String(formData.get('leadId'));

  const parsed = verifyLeadMobileSchema.safeParse({
    method: formData.get('method'),
    note: formData.get('note') || undefined,
  });

  if (!parsed.success) {
    return { status: 'error', message: 'Choose how you reached the client.' };
  }

  try {
    await apiFetch(`/leads/${leadId}/verify-mobile`, { method: 'POST', body: parsed.data });
  } catch (error) {
    return toErrorState(error, 'That could not be recorded.');
  }

  revalidatePath(`/leads/${leadId}`);
  revalidatePath('/leads');
  return { status: 'success', message: 'Mobile confirmed.' };
}

export async function unverifyLeadMobile(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const leadId = String(formData.get('leadId'));

  try {
    await apiFetch(`/leads/${leadId}/verify-mobile`, { method: 'DELETE' });
  } catch (error) {
    return toErrorState(error, 'That could not be undone.');
  }

  revalidatePath(`/leads/${leadId}`);
  revalidatePath('/leads');
  return { status: 'success', message: 'Confirmation withdrawn.' };
}

/**
 * Product lines from the form.
 *
 * The form posts one `productValue.<CODE>` field per product the rep ticked.
 * A blank is dropped rather than sent as zero: "I discussed this and expect
 * nothing" and "I did not put a number on it" are different statements, and
 * only one of them should land in a forecast.
 */
function readProductValues(
  formData: FormData,
): Array<{ productCode: string; expectedInvestment: string }> | undefined {
  const values: Array<{ productCode: string; expectedInvestment: string }> = [];

  for (const [key, raw] of formData.entries()) {
    if (!key.startsWith('productValue.')) continue;
    const amount = String(raw).trim();
    if (!amount) continue;
    values.push({ productCode: key.slice('productValue.'.length), expectedInvestment: amount });
  }

  return values.length > 0 ? values : undefined;
}

export async function logActivity(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const entityId = String(formData.get('entityId'));
  const entityType = String(formData.get('entityType')) as 'LEAD' | 'CUSTOMER';
  const followUp = formData.get('nextFollowUpAt');
  const duration = formData.get('durationMinutes');

  const parsed = createActivitySchema.safeParse({
    entityType,
    entityId,
    type: formData.get('type'),
    direction: formData.get('direction') || 'OUTBOUND',
    subject: formData.get('subject'),
    body: formData.get('body') || undefined,
    outcome: formData.get('outcome') || undefined,
    durationMinutes: duration ? Number(duration) : undefined,
    nextFollowUpAt: followUp ? new Date(String(followUp)) : undefined,
    meetingMode: formData.get('meetingMode') || undefined,
    meetingLink: formData.get('meetingLink') || undefined,
    productValues: readProductValues(formData),
  });

  if (!parsed.success) {
    return {
      status: 'error',
      message: 'Please correct the highlighted fields.',
      errors: zodErrors(parsed.error.issues),
    };
  }

  try {
    await apiFetch('/activities', {
      method: 'POST',
      body: {
        ...parsed.data,
        occurredAt: parsed.data.occurredAt?.toISOString(),
        nextFollowUpAt: parsed.data.nextFollowUpAt?.toISOString(),
      },
    });
  } catch (error) {
    return toErrorState(error, 'The interaction could not be logged.');
  }

  // The status change rides along with the interaction, because "what happened"
  // and "where it now stands" are one thought for a rep — and a status left
  // behind as a separate step is a status that goes stale.
  //
  // Deliberately after the activity, and deliberately not fatal: the interaction
  // is the record worth keeping. If the transition is refused, the note is
  // already saved and the message says exactly what did and did not happen,
  // rather than discarding what the rep typed.
  const nextStatus = formData.get('nextStatus');
  if (entityType === 'LEAD' && nextStatus) {
    try {
      await apiFetch(`/leads/${entityId}/status`, {
        method: 'POST',
        body: {
          status: String(nextStatus),
          lostReason: formData.get('lostReason') || undefined,
          nextFollowUpAt: parsed.data.nextFollowUpAt?.toISOString(),
        },
      });
    } catch (error) {
      const failed = toErrorState(error, 'The status could not be changed.');
      revalidatePath(`/leads/${entityId}`);
      return {
        ...failed,
        message: `Interaction saved, but the status did not change. ${failed.message ?? ''}`.trim(),
      };
    }
  }

  revalidatePath(`/${entityType === 'LEAD' ? 'leads' : 'customers'}/${entityId}`);
  return {
    status: 'success',
    message: nextStatus ? 'Interaction saved and status updated.' : 'Interaction saved.',
  };
}

/**
 * Hand a lead to someone outside the caller's own team.
 *
 * Separate action rather than a flag on assign, because the two differ in what
 * they demand: a transfer will not go through without a reason, and that reason
 * is what the next person to open the lead reads first.
 */
export async function transferLead(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const leadId = String(formData.get('leadId'));
  const ownerId = String(formData.get('ownerId') ?? '');
  const reason = String(formData.get('reason') ?? '').trim();

  if (!ownerId) return { status: 'error', message: 'Choose who the lead is moving to.' };
  if (reason.length < 10) {
    return {
      status: 'error',
      message: 'Say why this lead is moving — a few words is not enough.',
      errors: { reason: ['A reason of at least 10 characters is required'] },
    };
  }

  try {
    await apiFetch(`/leads/${leadId}/transfer`, { method: 'POST', body: { ownerId, reason } });
  } catch (error) {
    return toErrorState(error, 'The lead could not be transferred.');
  }

  revalidatePath(`/leads/${leadId}`);
  revalidatePath('/leads');
  return { status: 'success', message: 'Lead transferred.' };
}

export async function assignLead(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const leadId = String(formData.get('leadId'));
  const ownerId = String(formData.get('ownerId'));

  if (!ownerId) {
    return { status: 'error', message: 'Choose someone to assign this lead to.' };
  }

  try {
    await apiFetch(`/leads/${leadId}/assign`, {
      method: 'POST',
      body: { ownerId, note: formData.get('note') || undefined },
    });
  } catch (error) {
    return toErrorState(error, 'The lead could not be assigned.');
  }

  revalidatePath(`/leads/${leadId}`);
  revalidatePath('/leads');
  return { status: 'success', message: 'Lead reassigned.' };
}

export async function convertLead(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const leadId = String(formData.get('leadId'));

  const parsed = convertLeadSchema.safeParse({
    pan: formData.get('pan'),
    email: formData.get('email'),
    note: formData.get('note') || undefined,
  });

  if (!parsed.success) {
    return {
      status: 'error',
      message: 'A valid PAN and email are required to convert a lead.',
      errors: zodErrors(parsed.error.issues),
    };
  }

  let result: { customerId: string };
  try {
    result = await apiFetch<{ customerId: string }>(`/leads/${leadId}/convert`, {
      method: 'POST',
      body: parsed.data,
    });
  } catch (error) {
    return toErrorState(error, 'The lead could not be converted.');
  }

  revalidatePath('/leads');
  revalidatePath('/customers');
  redirect(`/customers/${result.customerId}`);
}
