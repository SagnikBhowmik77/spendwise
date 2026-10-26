import { useState } from 'react';
import toast from 'react-hot-toast';
import { Copy, Users } from 'lucide-react';
import { useSpace } from '../context/SpaceContext.jsx';
import { localeTag, t, tn } from '../lib/i18n.js';
import { useCreateSpace, useDeleteSpace, useInvite, useRemoveMember, useRenameSpace, useRevokeInvite, useSpaceSettings, useUpdateMember } from '../hooks/api.js';
import { formatINR } from '../lib/format.js';
// Timestamps (not calendar days) are shown in the viewer's own time zone.
const localDay = (ts) => new Date(ts).toLocaleDateString(localeTag(), { day: 'numeric', month: 'short', year: 'numeric' });
import { ConfirmDialog } from '../components/Modal.jsx';
import { Badge, Button, Card, CardHeader, EmptyState, Field, Input, PageHeader, Select, Skeleton } from '../components/ui.jsx';

// Batch 12R: what each role may do.
export const ROLE_LABEL = { owner: t('Owner'), editor: t('Editor'), viewer: t('Viewer'), child: t('Child') };
const ROLE_HINT = { editor: t('Adds and changes everything'), viewer: t('Only looks'), child: t('Adds own expenses, within pocket money') };
const ROLE_TONE = { owner: 'indigo', editor: 'slate', viewer: 'green', child: 'amber' };
const rupees = (s) => String(s ?? '').trim().replace(/,/g, '');

function PocketMoney({ space, member }) {
  const update = useUpdateMember();
  const [value, setValue] = useState(member.pocketMoney ? String(member.pocketMoney.rupees) : '');
  const changed = rupees(value) !== (member.pocketMoney ? String(member.pocketMoney.rupees) : '');
  return (
    <form className="flex items-center gap-1" onSubmit={async (e) => {
      e.preventDefault();
      try { await update.mutateAsync({ id: space.id, userId: member.id, pocketMoney: rupees(value) || null }); toast.success(rupees(value) ? t('Pocket money set') : t('No pocket-money limit')); } catch (err) { toast.error(err.details?.[0]?.message ?? err.message); }
    }}>
      <div className="w-28"><Input aria-label={t('Pocket money a month for {name} (₹)', { name: member.name })} inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} placeholder={t('₹ a month')} /></div>
      {changed && <Button type="submit" size="sm" variant="secondary" loading={update.isPending}>{t('Save')}</Button>}
    </form>
  );
}

function ApprovalSetting({ space }) {
  const save = useSpaceSettings();
  const [value, setValue] = useState(space.approvalAbove ? String(space.approvalAbove.rupees) : '');
  return (
    <form className="mb-5 flex flex-wrap items-end gap-2" onSubmit={async (e) => {
      e.preventDefault();
      try { await save.mutateAsync({ id: space.id, approvalAbove: rupees(value) || null }); toast.success(rupees(value) ? t('Big expenses now need your approval') : t('Approval turned off')); } catch (err) { toast.error(err.details?.[0]?.message ?? err.message); }
    }}>
      <Field label={t('Expenses above this need your approval (₹)')} htmlFor="approval-above" hint={t('Leave empty to turn it off. Until you approve, they count nowhere.')} className="min-w-0 flex-1">
        <Input id="approval-above" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} placeholder="5000" />
      </Field>
      <Button type="submit" variant="secondary" loading={save.isPending}>{t('Save')}</Button>
    </form>
  );
}

function CreateSpace() {
  const create = useCreateSpace();
  const { switchTo } = useSpace();
  const [name, setName] = useState('');
  async function submit(e) {
    e.preventDefault();
    try {
      const { space } = await create.mutateAsync({ name: name.trim() });
      switchTo(space.id);
      toast.success(t('“{name}” created. Invite people from here.', { name: space.name }));
      setName('');
    } catch (err) {
      toast.error(err.message);
    }
  }
  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
      <Field label={t('New shared space')} htmlFor="space-name" className="min-w-0 flex-1">
        <Input id="space-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder={t('e.g. Home, Flat 302, Goa trip')} />
      </Field>
      <Button type="submit" loading={create.isPending} disabled={!name.trim()}>{t('Create')}</Button>
    </form>
  );
}

function InviteForm({ space }) {
  const invite = useInvite();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('editor');
  const [result, setResult] = useState(null);
  async function submit(e) {
    e.preventDefault();
    try {
      const res = await invite.mutateAsync({ id: space.id, email: email.trim(), role });
      setResult(res);
      setEmail('');
      toast.success(res.emailed ? t('Invite emailed to {email}', { email: res.invite.email }) : t('Invite created. Share the link below.'));
    } catch (err) {
      toast.error(err.fieldErrors().email ?? err.message);
    }
  }
  const copy = async () => {
    try { await navigator.clipboard.writeText(result.link); toast.success(t('Link copied')); } catch { toast.error(t('Copy failed; select the link and copy it')); }
  };
  return (
    <div className="space-y-3">
      <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
        <Field label={t('Invite by email')} htmlFor="invite-email" className="min-w-0 flex-1">
          <Input id="invite-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="partner@example.com" />
        </Field>
        <Field label={t('As')} htmlFor="invite-role"><Select id="invite-role" value={role} onChange={(e) => setRole(e.target.value)}>{['editor', 'viewer', 'child'].map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</Select></Field>
        <Button type="submit" loading={invite.isPending} disabled={!email.trim()}>{t('Send invite')}</Button>
      </form>
      {result && (
        <div className="rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-800/60">
          <p>{result.emailed ? t('Emailed. You can also share this link:') : t('Email isn’t set up on this server, so share this link yourself:')}</p>
          <div className="mt-2 flex gap-2">
            <Input readOnly value={result.link} onFocus={(e) => e.target.select()} aria-label={t('Invite link')} />
            <Button variant="secondary" onClick={copy} aria-label={t('Copy invite link')}><Copy className="h-4 w-4" aria-hidden="true" /></Button>
          </div>
          <a className="mt-2 inline-block font-medium text-indigo-600 hover:underline dark:text-indigo-400" target="_blank" rel="noreferrer"
            href={`https://wa.me/?text=${encodeURIComponent(t('Join “{name}” on Spendwise: {link}', { name: space.name, link: result.link }))}`}>{t('Share on WhatsApp')}</a>
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{t('Works for 7 days, only for {email}.', { email: result.invite.email })}</p>
        </div>
      )}
    </div>
  );
}

export default function Household() {
  const updateMember = useUpdateMember();
  const { space, spaces, switchTo, loading } = useSpace();
  const rename = useRenameSpace();
  const removeMember = useRemoveMember();
  const revoke = useRevokeInvite();
  const del = useDeleteSpace();
  const [name, setName] = useState(null);
  const [confirm, setConfirm] = useState(null); // { kind: 'leave' | 'delete' | 'remove', member? }
  const owner = space?.role === 'owner';

  async function act() {
    const c = confirm;
    setConfirm(null);
    try {
      if (c.kind === 'delete') {
        await del.mutateAsync(space.id);
        switchTo(null);
        toast.success(t('Space deleted'));
      } else {
        const me = space.members.find((m) => m.you);
        await removeMember.mutateAsync({ id: space.id, userId: c.kind === 'leave' ? me.id : c.member.id });
        if (c.kind === 'leave') { switchTo(null); toast.success(t('You left “{name}”', { name: space.name })); } else toast.success(t('{name} was removed', { name: c.member.name }));
      }
    } catch (err) {
      toast.error(err.message);
    }
  }

  return (
    <>
      <PageHeader title={t('Household')} subtitle={t('Share a budget with a partner or flatmates. Everyone in a space sees and edits the same accounts and entries.')} />
      <div className="mx-auto max-w-3xl space-y-4">
        <Card>
          <CardHeader title={t('Your spaces')} />
          <ul className="mb-4 space-y-2">
            {spaces.map((s) => (
              <li key={s.id} className="flex items-center gap-3 text-sm">
                <span className="min-w-0 flex-1 truncate font-medium">{s.kind === 'personal' ? t('Personal') : s.name}</span>
                <span className="text-slate-500 dark:text-slate-400">{tn(s.memberCount, '{n} person', '{n} people')}</span>
                {s.id === space?.id
                  ? <Badge tone="indigo">{t('Open')}</Badge>
                  : <Button variant="ghost" size="sm" onClick={() => switchTo(s.kind === 'personal' ? null : s.id)}>{t('Open')}</Button>}
              </li>
            ))}
          </ul>
          <CreateSpace />
        </Card>

        {loading || !space ? <Skeleton className="h-40 w-full" /> : space.kind === 'personal' ? (
          <Card>
            <EmptyState icon={Users} title={t('This is your personal space')}>
              {t('Only you can see it. Create a shared space above to track household or flat expenses together.')}
            </EmptyState>
          </Card>
        ) : (
          <Card>
            <CardHeader title={space.name} subtitle={owner ? t('You’re the owner') : t('You’re {role}: {hint}', { role: ROLE_LABEL[space.role], hint: ROLE_HINT[space.role] })} />
            {owner && <ApprovalSetting space={space} />}
            {owner && (
              <form className="mb-5 flex flex-wrap items-end gap-2" onSubmit={async (e) => {
                e.preventDefault();
                try { await rename.mutateAsync({ id: space.id, name: name.trim() }); setName(null); toast.success(t('Renamed')); } catch (err) { toast.error(err.message); }
              }}>
                <Field label={t('Name')} htmlFor="rename" className="min-w-0 flex-1">
                  <Input id="rename" value={name ?? space.name} onChange={(e) => setName(e.target.value)} maxLength={40} />
                </Field>
                <Button type="submit" variant="secondary" disabled={!name?.trim() || name.trim() === space.name} loading={rename.isPending}>{t('Rename')}</Button>
              </form>
            )}
            <h3 className="mb-2 text-sm font-semibold">{t('People')}</h3>
            <ul className="mb-5 divide-y divide-slate-900/[0.05] dark:divide-white/[0.05]">
              {space.members.map((m) => (
                <li key={m.id} className="flex flex-wrap items-center gap-2 py-2.5 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{m.name}{m.you ? ` (${t('you')})` : ''}</p>
                    <p className="truncate text-xs text-slate-500 dark:text-slate-400">{t('{email} · joined {date}', { email: m.email, date: localDay(m.joinedAt) })}</p>
                  </div>
                  {owner && m.role !== 'owner' ? (
                    <div className="w-32"><Select aria-label={t('Role of {name}', { name: m.name })} value={m.role} onChange={async (e) => {
                      try { await updateMember.mutateAsync({ id: space.id, userId: m.id, role: e.target.value }); toast.success(t('{name} is now {role}', { name: m.name, role: ROLE_LABEL[e.target.value] })); } catch (err) { toast.error(err.message); }
                    }}>{['editor', 'viewer', 'child'].map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</Select></div>
                  ) : <Badge tone={ROLE_TONE[m.role]}>{ROLE_LABEL[m.role]}</Badge>}
                  {owner && m.role === 'child' && <PocketMoney space={space} member={m} />}
                  {!owner && m.role === 'child' && m.pocketMoney && <span className="tabular text-xs text-slate-500 dark:text-slate-400">{t('{amount} a month', { amount: formatINR(m.pocketMoney.paise) })}</span>}
                  {m.you
                    ? <Button variant="ghost" size="sm" onClick={() => setConfirm({ kind: 'leave' })}>{t('Leave')}</Button>
                    : owner && <Button variant="ghost" size="sm" className="hover:text-rose-600" onClick={() => setConfirm({ kind: 'remove', member: m })}>{t('Remove')}</Button>}
                </li>
              ))}
            </ul>
            {owner && (
              <>
                <InviteForm space={space} />
                {space.invites.length > 0 && (
                  <div className="mt-5">
                    <h3 className="mb-2 text-sm font-semibold">{t('Waiting to accept')}</h3>
                    <ul className="space-y-1.5 text-sm">
                      {space.invites.map((i) => (
                        <li key={i.id} className="flex items-center gap-2">
                          <span className="min-w-0 flex-1 truncate">{i.email}</span>
                          <Badge tone={ROLE_TONE[i.role]}>{ROLE_LABEL[i.role]}</Badge>
                          <span className="text-xs text-slate-500 dark:text-slate-400">{t('until {date}', { date: localDay(i.expiresAt) })}</span>
                          <Button variant="ghost" size="sm" onClick={async () => {
                            try { await revoke.mutateAsync({ id: space.id, inviteId: i.id }); toast.success(t('Invite cancelled')); } catch (err) { toast.error(err.message); }
                          }}>{t('Cancel')}</Button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <div className="mt-6 border-t border-slate-900/[0.06] pt-4 dark:border-white/[0.06]">
                  <Button variant="danger" onClick={() => setConfirm({ kind: 'delete' })}>{t('Delete this space')}</Button>
                </div>
              </>
            )}
          </Card>
        )}
      </div>
      <ConfirmDialog open={confirm !== null} danger
        title={{ leave: t('Leave this space?'), delete: t('Delete this space?'), remove: t('Remove {name}?', { name: confirm?.member?.name }) }[confirm?.kind] ?? ''}
        confirmLabel={{ leave: t('Leave'), delete: t('Delete everything'), remove: t('Remove') }[confirm?.kind] ?? t('OK')}
        onClose={() => setConfirm(null)} onConfirm={act}>
        {confirm?.kind === 'leave' && (space?.members.length === 1
          ? t('You’re the only one here, so leaving deletes the space and everything in it.')
          : owner ? t('You’ll lose access. The entries you added stay with the space. The longest-standing member becomes the owner.') : t('You’ll lose access. The entries you added stay with the space.'))}
        {confirm?.kind === 'delete' && t('All accounts, entries, budgets and recurring rules in this space are deleted for everyone. This can’t be undone.')}
        {confirm?.kind === 'remove' && t('They lose access. Entries they added stay.')}
      </ConfirmDialog>
    </>
  );
}
