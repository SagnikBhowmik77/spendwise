// The built-in category names the server suggests (server/src/categories.js), marked so their Hindi is
// checked. They are stored in English; only their display changes with the language (see catLabel).
import { k } from './i18n.js';

export const BUILTIN_CATEGORIES = new Set([
  k('Salary'), k('Freelance'), k('Business'), k('Interest'), k('Investments'), k('Rental income'), k('Gifts'), k('Refunds'), k('Other'),
  k('Food & Dining'), k('Groceries'), k('Rent'), k('Transport'), k('Fuel'), k('Shopping'), k('Bills & Utilities'),
  k('Mobile & Internet'), k('Health'), k('Education'), k('Entertainment'), k('Travel'), k('Personal care'),
  k('EMI & Loans'), k('Insurance'), k('Gifts & Donations'),
  // Shown in place of a category for transfers and split entries.
  k('Split'), k('Transfer'),
]);
