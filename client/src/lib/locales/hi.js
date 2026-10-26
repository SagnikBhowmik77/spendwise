// Hindi for the whole app, one file per area. Keys are the English text exactly as written in the code.
import core from './hi/core.js';
import money from './hi/money.js';
import settings from './hi/settings.js';
import pages1 from './hi/pages1.js';
import pages2 from './hi/pages2.js';

export default { ...core, ...money, ...settings, ...pages1, ...pages2 };
