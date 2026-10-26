import { z } from 'zod';
import { MAX_AMOUNT_PAISE } from '../models/index.js';
import { DATE_FORMATS, SIGN_STYLES } from '../statement.js';
import { MAX_IMPORT_ROWS } from '../services/import.service.js';
import { category, entryDay, moneyType, note, objectId, paymentMethod, time, type } from './transaction.schemas.js';

const MAX_COLUMNS = 60;
const column = z.number({ error: 'Choose a column' }).int().min(0).max(MAX_COLUMNS - 1);
const optionalColumn = column.nullable().optional();
const cell = z.union([z.string(), z.number(), z.boolean(), z.null()]).transform((v) => (v === null ? '' : String(v).slice(0, 1000)));

// Which column holds what. Amounts come from one signed column or from separate debit and credit columns.
export const mappingSchema = z
  .object({
    date: column,
    description: column,
    time: optionalColumn,
    amount: optionalColumn,
    debit: optionalColumn,
    credit: optionalColumn,
    drcr: optionalColumn,
    sign: z.enum(SIGN_STYLES).default('negative-is-spending'),
    dateFormat: z.enum(DATE_FORMATS).default('auto'),
  })
  .superRefine((m, ctx) => {
    const split = m.debit != null || m.credit != null;
    if (split && m.debit == null) ctx.addIssue({ code: 'custom', path: ['debit'], message: 'Choose the debit (withdrawal) column' });
    if (split && m.credit == null) ctx.addIssue({ code: 'custom', path: ['credit'], message: 'Choose the credit (deposit) column' });
    if (!split && m.amount == null) ctx.addIssue({ code: 'custom', path: ['amount'], message: 'Choose the amount column' });
  });

const header = z.array(cell).max(MAX_COLUMNS, `Up to ${MAX_COLUMNS} columns`);
const fileRows = z
  .array(z.object({ line: z.number().int().min(1), cells: z.array(cell).max(MAX_COLUMNS, `Up to ${MAX_COLUMNS} columns`) }))
  .min(1, 'The file has no lines under the header')
  .max(MAX_IMPORT_ROWS, `Up to ${MAX_IMPORT_ROWS} lines per import; split the statement into smaller files`);

export const previewSchema = z.object({ account: objectId(), header: header.default([]), rows: fileRows, mapping: mappingSchema });

const pattern = z.string().trim().toLowerCase().min(2, 'A rule needs at least 2 characters').max(60, 'Up to 60 characters');
export const ruleSchema = z.object({ pattern, type: moneyType, category });

export const layoutSchema = z.object({
  name: z.string().trim().min(1, 'Name the layout, e.g. HDFC savings').max(40, 'Up to 40 characters'),
  header,
  mapping: mappingSchema,
});

const importRow = z
  .object({
    ref: z.string().regex(/^[a-f0-9]{32}$/, 'Preview the file again'),
    date: entryDay,
    time: time.optional(),
    type,
    direction: z.enum(['out', 'in']).optional(),
    otherAccount: objectId().nullable().optional(),
    amountPaise: z.number().int().min(1).max(MAX_AMOUNT_PAISE),
    category: category.optional(),
    merchant: z.string().trim().max(60).nullable().optional(),
    note: note.default(''),
    paymentMethod: paymentMethod.nullable().optional(),
  })
  .superRefine((r, ctx) => {
    if (r.type === 'transfer' && !r.otherAccount) ctx.addIssue({ code: 'custom', path: ['otherAccount'], message: 'Choose the other account of this transfer' });
    if (r.type !== 'transfer' && !r.category) ctx.addIssue({ code: 'custom', path: ['category'], message: 'Category is required' });
  });

export const commitSchema = z.object({
  account: objectId(),
  fileName: z.string().trim().max(120).default(''),
  rows: z.array(importRow).min(1, 'Pick at least one line to import').max(MAX_IMPORT_ROWS),
  rules: z.array(ruleSchema).max(50).default([]),
  layout: layoutSchema.optional(),
});
