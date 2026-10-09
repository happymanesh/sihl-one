import { z } from 'zod';

import { codeSchema } from './common';

/**
 * Product groups — the tier above the product master.
 *
 * The master already had two levels: a product and its sub-products, Intraday
 * and Delivery under Equity. What it had no way to say was that Equity, F&O,
 * Commodity, Currency, SLBM and Unlisted are all the same *business*, while
 * Fixed Deposit, Mutual Funds, Bonds and AIF are a different one. Sales talk in
 * those terms and the master could not, so every report that wanted "how is
 * wealth doing" had to hard-code a list of product codes somewhere.
 *
 * A group is a third tier rather than another parent-child level, because they
 * are not the same kind of thing: a sub-product is a way of buying its parent,
 * a group is a desk that sells several unrelated products. Folding them into
 * one hierarchy would make "Equity" both a product and a group, and every count
 * that walks the tree would have to know which it was looking at.
 *
 * Groups are data, like the products in them — created and renamed in the admin
 * screen. The list below is the starting set, applied on deploy to any product
 * that has no group yet and never over the top of one an administrator has set.
 */
export const PRODUCT_GROUP_SEED = [
  { code: 'BROKING', name: 'Broking', sortOrder: 10 },
  { code: 'WEALTH', name: 'Wealth', sortOrder: 20 },
  { code: 'RESEARCH', name: 'Research', sortOrder: 30 },
  { code: 'ALGO', name: 'Algo', sortOrder: 40 },
  { code: 'GLOBAL', name: 'Global', sortOrder: 50 },
] as const satisfies ReadonlyArray<{ code: string; name: string; sortOrder: number }>;

export type ProductGroupCode = (typeof PRODUCT_GROUP_SEED)[number]['code'];

/**
 * Where each product in the master starts out.
 *
 * Applied only to a product whose group is still unset, so an administrator who
 * moves something is never overruled by the next deploy. A product missing from
 * this map simply has no group until somebody gives it one — which is right for
 * the partner-programme entries (`PARTNERSHIP`, `AP`, `EP`), since they are
 * routes to market rather than things a desk sells.
 */
export const DEFAULT_PRODUCT_GROUP: Record<string, ProductGroupCode> = {
  // Broking — the sub-products come with their parent.
  EQUITY: 'BROKING',
  EQUITY_INTRADAY: 'BROKING',
  EQUITY_DELIVERY: 'BROKING',
  DERIVATIVES: 'BROKING',
  COMMODITY: 'BROKING',
  CURRENCY: 'BROKING',
  SLBM: 'BROKING',
  UNLISTED: 'BROKING',
  IPO: 'BROKING',

  // Wealth
  FD: 'WEALTH',
  MUTUAL_FUNDS: 'WEALTH',
  BONDS: 'WEALTH',
  AIF: 'WEALTH',
  PMS: 'WEALTH',
  INSURANCE: 'WEALTH',

  // Research
  ADVISORYPMS: 'RESEARCH',

  ALGO: 'ALGO',
  GLOBAL: 'GLOBAL',
  NRI: 'GLOBAL',
};

export const createProductGroupSchema = z.object({
  code: codeSchema,
  name: z.string().trim().min(2, 'Give the group a name').max(80),
  sortOrder: z.number().int().min(0).max(10_000).default(100),
});
export type CreateProductGroupInput = z.infer<typeof createProductGroupSchema>;

/**
 * The code is not here on purpose: it is immutable, as it is for every other
 * master. Products point at a group by id, but the seed map and the reports
 * that ask "how is wealth doing" are written against codes, so a renamed code
 * would quietly detach them. The name is the part meant to be changed.
 */
export const updateProductGroupSchema = createProductGroupSchema
  .omit({ code: true })
  .partial()
  .extend({ isActive: z.boolean().optional() });
export type UpdateProductGroupInput = z.infer<typeof updateProductGroupSchema>;

export interface ProductGroupSummary {
  id: string;
  code: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
  /** How many products sit in it, so an empty group is obvious in the list. */
  productCount: number;
}
