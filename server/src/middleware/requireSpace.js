import { HttpError } from '../errors.js';
import { runAs } from '../access.js';
import { Account, roleName, Transaction } from '../models/index.js';
import { resolveSpace } from '../services/space.service.js';

const READ_METHODS = new Set(['GET', 'HEAD']);
// Writes that only work something out, email it to you or set up your own calendar address, so viewers can too.
const VIEWER_WRITES = /^(POST \/api\/(insights\/preview|tax\/salary|reports\/send-test|integrations\/calendar)|DELETE \/api\/integrations\/calendar)$/;
const viewerWrite = (req, path) => VIEWER_WRITES.test(req.method + ' ' + path);
const RECEIPT = /^\/api\/transactions\/([a-f\d]{24})\/receipt$/i;
const READ_ONLY = () => new HttpError(403, 'read_only_member', 'You can look at this space but not change it. Ask the owner to make you an editor.');
const CHILD_ONLY = () => new HttpError(403, 'child_member', 'In this space you can only add your own expenses.');

// What a member's role lets them do here (batch 12R). Owners and editors: everything the routes allow.
async function checkRole(req, role, path) {
  if (READ_METHODS.has(req.method) || role === 'owner' || role === 'editor') return;
  if (role === 'viewer') {
    if (viewerWrite(req, path)) return;
    throw READ_ONLY();
  }
  // child
  if (req.method === 'POST' && path === '/api/transactions') {
    if (req.body?.type !== 'expense') throw CHILD_ONLY();
    return;
  }
  const receipt = RECEIPT.exec(path);
  if (receipt && ['PUT', 'DELETE'].includes(req.method)
    && await Transaction.exists({ _id: receipt[1], space: req.space._id, user: req.user._id })) return;
  if (viewerWrite(req, path)) return;
  throw CHILD_ONLY();
}

// After requireAuth: the space this request works in (X-Space-Id header, or the user's personal space).
// Sets req.space and req.role; a space the user doesn't belong to answers 404. An API token always works in its
// own space. The rest of the request runs knowing who is asking, so other members' private accounts stay hidden.
export async function requireSpace(req, _res, next) {
  const space = await resolveSpace(req.user, req.apiToken ? String(req.apiToken.space) : req.get('x-space-id'));
  req.space = space;
  const member = space.members.find((m) => String(m.user) === String(req.user._id));
  req.role = roleName(member?.role ?? 'owner');
  await checkRole(req, req.role, req.originalUrl.split('?')[0]);
  const hidden = space.kind === 'shared'
    ? (await runAs({ hidden: [] }, () => Account.find({ space: space._id, privateTo: { $nin: [null, req.user._id] } }).select('_id').lean().exec())).map((a) => a._id)
    : [];
  runAs({ userId: req.user._id, role: req.role, member, space, hidden }, next);
}
