import { z } from 'zod';

import {
  codeSchema, idSchema } from './common';

/**
 * Lead assignment rules.
 *
 * One engine, used by every path that creates or re-homes a lead: bulk import,
 * event capture, public web capture, and offboarding handover. Assignment logic
 * that lives separately in each of those drifts, and the drift shows up as
 * leads landing with the wrong person in exactly one of the four.
 */

export const ASSIGNMENT_STRATEGIES = [
  'ROUND_ROBIN',
  'LOAD_BALANCED',
  'FIXED_OWNER',
  'LEAVE_UNASSIGNED',
] as const;
export type AssignmentStrategy = (typeof ASSIGNMENT_STRATEGIES)[number];

export const STRATEGY_DESCRIPTIONS: Record<AssignmentStrategy, string> = {
  ROUND_ROBIN: 'Distribute evenly in turn across the selected people.',
  LOAD_BALANCED: 'Give each lead to whoever currently has the fewest open leads.',
  FIXED_OWNER: 'Always assign to one named person.',
  LEAVE_UNASSIGNED: 'Leave for a manager to allocate by hand.',
};

/**
 * Criteria are all optional and all ANDed. An empty criteria object matches
 * everything, which is how the catch-all default rule is expressed.
 */
export const assignmentCriteriaSchema = z.object({
  sources: z.array(codeSchema).max(12).optional(),
  products: z.array(codeSchema).max(12).optional(),
  cities: z.array(z.string().trim().min(1).max(80)).max(50).optional(),
  states: z.array(z.string().trim().min(1).max(80)).max(50).optional(),
  /** Minimum lead score, so high-intent leads can be routed differently. */
  minScore: z.number().int().min(0).max(100).optional(),
  campaignId: idSchema.optional(),
});
export type AssignmentCriteria = z.infer<typeof assignmentCriteriaSchema>;

export const createAssignmentRuleSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    /** Lower runs first. The first matching rule wins. */
    priority: z.number().int().min(0).max(1000).default(100),
    isActive: z.boolean().default(true),
    criteria: assignmentCriteriaSchema.default({}),
    strategy: z.enum(ASSIGNMENT_STRATEGIES),
    /** Candidate owners for ROUND_ROBIN and LOAD_BALANCED, or the single FIXED_OWNER. */
    targetUserIds: z.array(idSchema).max(100).default([]),
    orgUnitId: idSchema.optional(),
  })
  .refine(
    (rule) =>
      rule.strategy === 'LEAVE_UNASSIGNED' ? true : rule.targetUserIds.length > 0,
    {
      message: 'Choose at least one person for this rule to assign to',
      path: ['targetUserIds'],
    },
  )
  .refine(
    (rule) => (rule.strategy === 'FIXED_OWNER' ? rule.targetUserIds.length === 1 : true),
    {
      message: 'A fixed-owner rule must name exactly one person',
      path: ['targetUserIds'],
    },
  );
export type CreateAssignmentRuleInput = z.infer<typeof createAssignmentRuleSchema>;

export const updateAssignmentRuleSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  priority: z.number().int().min(0).max(1000).optional(),
  isActive: z.boolean().optional(),
  criteria: assignmentCriteriaSchema.optional(),
  strategy: z.enum(ASSIGNMENT_STRATEGIES).optional(),
  targetUserIds: z.array(idSchema).max(100).optional(),
  orgUnitId: idSchema.nullable().optional(),
});
export type UpdateAssignmentRuleInput = z.infer<typeof updateAssignmentRuleSchema>;

/** The lead attributes a rule can be matched against. */
export interface AssignableLead {
  source: string;
  productInterest: readonly string[];
  city?: string | null;
  state?: string | null;
  score?: number;
  campaignId?: string | null;
}

export interface MatchableRule {
  id: string;
  name: string;
  priority: number;
  isActive: boolean;
  criteria: AssignmentCriteria;
  strategy: AssignmentStrategy;
  targetUserIds: string[];
}

/**
 * Does this rule apply to this lead?
 *
 * Case-insensitive on free text, because "ahmedabad", "Ahmedabad" and
 * "AHMEDABAD" all arrive in real import files and none of them should decide
 * whether a lead reaches a salesperson.
 */
export function ruleMatches(rule: MatchableRule, lead: AssignableLead): boolean {
  if (!rule.isActive) return false;
  const { criteria } = rule;

  if (criteria.sources?.length && !criteria.sources.includes(lead.source as never)) {
    return false;
  }

  if (criteria.products?.length) {
    const wanted = new Set(criteria.products as readonly string[]);
    if (!lead.productInterest.some((product) => wanted.has(product))) return false;
  }

  if (criteria.cities?.length) {
    const wanted = criteria.cities.map((city) => city.trim().toLowerCase());
    if (!lead.city || !wanted.includes(lead.city.trim().toLowerCase())) return false;
  }

  if (criteria.states?.length) {
    const wanted = criteria.states.map((state) => state.trim().toLowerCase());
    if (!lead.state || !wanted.includes(lead.state.trim().toLowerCase())) return false;
  }

  if (criteria.minScore !== undefined && (lead.score ?? 0) < criteria.minScore) {
    return false;
  }

  if (criteria.campaignId && lead.campaignId !== criteria.campaignId) return false;

  return true;
}

/** First matching rule by priority, then by name for a stable tiebreak. */
export function selectRule(
  rules: readonly MatchableRule[],
  lead: AssignableLead,
): MatchableRule | null {
  return (
    [...rules]
      .filter((rule) => rule.isActive)
      .sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name))
      .find((rule) => ruleMatches(rule, lead)) ?? null
  );
}

export interface OwnerWorkload {
  userId: string;
  openLeads: number;
}

/**
 * Picks the owner within a rule.
 *
 * `roundRobinCursor` is the count of assignments the rule has already made,
 * persisted on the rule row. Keeping it in the database rather than in process
 * memory is what makes distribution even across several API pods — an in-memory
 * counter gives every pod its own rotation and quietly favours whoever sits at
 * index 0.
 */
export function selectOwner(
  rule: MatchableRule,
  workloads: readonly OwnerWorkload[],
  roundRobinCursor: number,
): string | null {
  if (rule.strategy === 'LEAVE_UNASSIGNED') return null;
  if (rule.targetUserIds.length === 0) return null;

  if (rule.strategy === 'FIXED_OWNER') return rule.targetUserIds[0] ?? null;

  if (rule.strategy === 'ROUND_ROBIN') {
    const index = Math.abs(roundRobinCursor) % rule.targetUserIds.length;
    return rule.targetUserIds[index] ?? null;
  }

  // LOAD_BALANCED. Anyone with no workload row has no open leads at all, so
  // they are the emptiest by definition and should be picked first.
  const byLoad = rule.targetUserIds
    .map((userId) => ({
      userId,
      openLeads: workloads.find((entry) => entry.userId === userId)?.openLeads ?? 0,
    }))
    // Sort by load, then by id, so an even spread does not depend on array order.
    .sort((a, b) => a.openLeads - b.openLeads || a.userId.localeCompare(b.userId));

  return byLoad[0]?.userId ?? null;
}

// ---------------------------------------------------------------------------
// Offboarding
// ---------------------------------------------------------------------------

export const OFFBOARD_STRATEGIES = ['SINGLE_OWNER', 'ROUND_ROBIN', 'RULES_ENGINE', 'UNASSIGN'] as const;
export type OffboardStrategy = (typeof OFFBOARD_STRATEGIES)[number];

export const offboardUserSchema = z
  .object({
    strategy: z.enum(OFFBOARD_STRATEGIES),
    /** Required for SINGLE_OWNER; the pool for ROUND_ROBIN. */
    targetUserIds: z.array(idSchema).max(50).default([]),
    reason: z.string().trim().min(3, 'Record why this user is being offboarded').max(300),
    /**
     * Closed leads and completed visits stay with the departing user for
     * historical accuracy. Only live work moves.
     */
    includeCustomers: z.boolean().default(true),
    includeTasks: z.boolean().default(true),
  })
  .refine(
    (input) =>
      input.strategy === 'UNASSIGN' || input.strategy === 'RULES_ENGINE'
        ? true
        : input.targetUserIds.length > 0,
    { message: 'Choose who should receive this work', path: ['targetUserIds'] },
  )
  .refine(
    (input) => (input.strategy === 'SINGLE_OWNER' ? input.targetUserIds.length === 1 : true),
    { message: 'Choose exactly one person to receive everything', path: ['targetUserIds'] },
  );
export type OffboardUserInput = z.infer<typeof offboardUserSchema>;

export interface OffboardPreview {
  user: { id: string; fullName: string; email: string; status: string };
  holdings: {
    openLeads: number;
    closedLeads: number;
    customers: number;
    openTasks: number;
    plannedVisits: number;
    activeSessions: number;
  };
  /** What the handover will actually move, as opposed to what they hold. */
  willReassign: { leads: number; customers: number; tasks: number; visits: number };
}
