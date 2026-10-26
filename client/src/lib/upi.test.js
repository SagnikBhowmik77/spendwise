import { test } from 'node:test';
import assert from 'node:assert/strict';
import { upiLink } from './upi.js';

test('UPI pay links carry the payee, amount in rupees and a short note', () => {
  assert.equal(
    upiLink({ upiId: 'asha@okaxis', name: 'Asha Rao', amountPaise: 40_050, note: 'Goa trip settle-up' }),
    'upi://pay?pa=asha@okaxis&pn=Asha%20Rao&am=400.50&cu=INR&tn=Goa%20trip%20settle-up',
  );
  assert.equal(upiLink({ upiId: 'b@ybl', name: 'B & Co', amountPaise: 100 }), 'upi://pay?pa=b@ybl&pn=B%20%26%20Co&am=1.00&cu=INR');
});
