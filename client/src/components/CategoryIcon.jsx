// A quiet icon tile per category, so lists read at a glance without colour doing the work.
// Built-in categories get their own icon; ones you made yourself get a neutral tag.
import {
  ArrowLeftRight, BookOpen, Briefcase, Car, Clapperboard, Fuel, Gift, HeartPulse, House, Landmark, Laptop, Percent, PiggyBank,
  Plane, Receipt, RotateCcw, Scissors, ShieldCheck, ShoppingBag, ShoppingBasket, Smartphone, Split, Store, Tag, TrendingUp, Utensils, Zap,
} from 'lucide-react';
import { cx } from './ui.jsx';

const ICONS = {
  'Food & Dining': Utensils, Groceries: ShoppingBasket, Rent: House, Transport: Car, Fuel, Shopping: ShoppingBag,
  'Bills & Utilities': Zap, 'Mobile & Internet': Smartphone, Health: HeartPulse, Education: BookOpen, Entertainment: Clapperboard,
  Travel: Plane, 'Personal care': Scissors, 'EMI & Loans': Landmark, Insurance: ShieldCheck, Investments: TrendingUp,
  'Gifts & Donations': Gift, Salary: Briefcase, Freelance: Laptop, Business: Store, Interest: Percent, 'Rental income': House,
  Gifts: Gift, Refunds: RotateCcw, Split, Transfer: ArrowLeftRight, Savings: PiggyBank, Other: Receipt,
};

export const categoryIcon = (category) => ICONS[category] ?? Tag;

// tone: 'income' gets a faint green tile; everything else stays neutral.
export default function CategoryIcon({ category, tone, size = 'md', className }) {
  const Icon = categoryIcon(category);
  return (
    <span className={cx(
      'grid shrink-0 place-items-center rounded-xl',
      size === 'sm' ? 'h-8 w-8' : 'h-10 w-10',
      tone === 'income'
        ? 'bg-emerald-500/10 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-300'
        : 'bg-slate-900/[0.05] text-slate-600 dark:bg-white/[0.06] dark:text-slate-300',
      className,
    )}>
      <Icon className={size === 'sm' ? 'h-4 w-4' : 'h-[1.125rem] w-[1.125rem]'} aria-hidden="true" strokeWidth={1.75} />
    </span>
  );
}
