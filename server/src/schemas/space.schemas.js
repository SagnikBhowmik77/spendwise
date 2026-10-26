import { z } from 'zod';
import { amount } from './transaction.schemas.js';

const name = z.string().trim().min(1, 'Name is required').max(40, 'Name must be at most 40 characters');
const email = z.string().trim().toLowerCase().pipe(z.email('Enter a valid email address')).pipe(z.string().max(254));

export const spaceNameSchema = z.object({ name });
export const inviteSchema = z.object({ email });
export const activityQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  entityId: z.string().regex(/^[a-f\d]{24}$/i, 'Unknown entry').optional(),
});

// Batch 12R: roles, pocket money and approvals.
const role = z.enum(['editor', 'viewer', 'child'], { error: 'Editor, viewer or child' });
export const inviteWithRoleSchema = z.object({ email, role: role.default('editor') });
export const memberUpdateSchema = z.object({ role, pocketMoney: amount.nullable() }).partial()
  .refine((v) => Object.keys(v).length > 0, 'Send at least one field to change');
export const spaceSettingsSchema = z.object({ approvalAbove: amount.nullable() });
