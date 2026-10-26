import { z } from 'zod';
import { filterFields, fromBeforeTo, moneyType } from './transaction.schemas.js';

// Stats are about money in and out, so the type filter is income or expense (never transfer).
const statsFields = { ...filterFields, type: moneyType.optional() };

export const summaryQuery = z.object(statsFields).refine(...fromBeforeTo);

// Pie charts are about one side of the ledger at a time; expenses unless asked otherwise.
export const byCategoryQuery = z.object({ ...statsFields, type: moneyType.default('expense') }).refine(...fromBeforeTo);

export const seriesQuery = z.object(statsFields).refine(...fromBeforeTo);
