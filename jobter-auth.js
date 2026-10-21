/* ======================================================================
   JOBTER - STAGE 1 (v3, for the latest index.html)
   Real accounts (Supabase Auth) + Alias Studio saving.
   Load AFTER the main inline script, BEFORE Alpine starts:
   put <script src="jobter-auth.js"></script> just above </body>.
   Needs the global `sb` client defined in index.html's <head>.
   ====================================================================== */
(function () {
  'use strict';

  var original = window.jobterMarketplace;
  if (typeof original !== 'function' || typeof sb === 'undefined') {
    console.error('jobter-auth.js: jobterMarketplace() or the Supabase client `sb` was not found.');
    return;
  }

  /* ---------- 1. Page edits (run before Alpine starts) ---------- */
  var INPUT = 'w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-3.5 py-3 text-sm text-jobterBlack dark:text-white focus:outline-none focus:border-jobterBlue';
  var LABEL = 'block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1';
  var TAB = 'flex-1 py-2 rounded-lg transition';

  var AUTH_HTML =
    '<div x-show="authOpen" x-cloak x-transition.opacity class="fixed inset-0 z-[60] bg-jobterBlack/80 backdrop-blur-sm flex items-center justify-center p-4">' +
      '<div class="bg-white dark:bg-jobterDarkCard rounded-3xl max-w-md w-full p-6 sm:p-7 border border-slate-200 dark:border-slate-800 shadow-2xl space-y-5">' +
        '<div><span class="text-[11px] font-bold uppercase tracking-wider text-jobterBlue">Jobter Account</span>' +
        '<h3 class="font-extrabold text-xl text-jobterBlack dark:text-white mt-0.5" x-text="authTab === \'signup\' ? \'Create your account\' : \'Welcome back\'"></h3></div>' +
        '<div class="bg-slate-100 dark:bg-slate-800 p-1 rounded-xl flex text-xs font-bold">' +
          '<button type="button" @click="authTab = \'signup\'; authError = \'\'; authInfo = \'\'" :class="authTab === \'signup\' ? \'bg-white dark:bg-slate-900 shadow-sm text-jobterBlack dark:text-white\' : \'text-slate-500\'" class="' + TAB + '">Sign up</button>' +
          '<button type="button" @click="authTab = \'login\'; authError = \'\'; authInfo = \'\'" :class="authTab === \'login\' ? \'bg-white dark:bg-slate-900 shadow-sm text-jobterBlack dark:text-white\' : \'text-slate-500\'" class="' + TAB + '">Log in</button>' +
        '</div>' +
        '<form @submit.prevent="submitAuth()" class="space-y-4">' +
          '<div><label class="' + LABEL + '">Email</label><input type="email" required autocomplete="email" x-model="authEmail" class="' + INPUT + '"></div>' +
          '<div><label class="' + LABEL + '">Password (at least 8 characters)</label>' +
            '<input type="password" required minlength="8" :autocomplete="authTab === \'signup\' ? \'new-password\' : \'current-password\'" x-model="authPassword" class="' + INPUT + '"></div>' +
          '<p x-show="authError" x-cloak class="text-xs font-semibold text-red-600" x-text="authError"></p>' +
          '<p x-show="authInfo" x-cloak class="text-xs font-semibold text-emerald-700" x-text="authInfo"></p>' +
          '<button type="submit" :disabled="authBusy" class="w-full bg-jobterBlue hover:bg-jobterBlueDark disabled:opacity-60 text-white font-bold text-sm py-3.5 rounded-xl transition" ' +
            'x-text="authBusy ? \'Please wait...\' : (authTab === \'signup\' ? \'Create account\' : \'Log in\')"></button>' +
        '</form>' +
        '<p class="text-[11px] text-slate-500 leading-relaxed">Other users only ever see your alias. Your email is never shown publicly.</p>' +
        '<button type="button" @click="authOpen = false" class="w-full text-xs font-semibold text-slate-500 hover:text-jobterBlack dark:hover:text-white underline">Not now</button>' +
      '</div>' +
    '</div>';

  var SIGNOUT_ATTRS = 'x-show="session" x-cloak @click="signOut()"';
  var DESKTOP_BTN = '<button type="button" ' + SIGNOUT_ATTRS +
    ' class="hidden sm:block bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-jobterBlack dark:text-white text-xs font-bold px-3 py-2.5 rounded-xl transition shrink-0">Sign out</button>';
  var MOBILE_BTN = '<button type="button" ' + SIGNOUT_ATTRS +
    ' class="sm:hidden bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 px-3.5 py-1.5 rounded-xl shrink-0">Sign out</button>';

  var KYC_NOTICE =
    '<h3 class="font-extrabold text-xs text-blue-900 dark:text-blue-300 uppercase">Identity Verification</h3>' +
    '<p class="text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed">Verification with NIN and utility bill, or Student ID, opens soon. ' +
    'Nothing is collected or stored yet, so please do not enter ID numbers or upload documents.</p>';

  document.body.insertAdjacentHTML('beforeend', AUTH_HTML);

  // Sign-out button next to the Wallet pill (header and mobile bar)
  var pill = Array.prototype.find.call(document.querySelectorAll('header button'), function (b) {
    return b.textContent.indexOf('Wallet:') !== -1;
  });
  if (pill) {
    pill.insertAdjacentHTML('afterend', DESKTOP_BTN);
    var hdr = pill.closest('header');
    if (hdr && hdr.children[1]) hdr.children[1].insertAdjacentHTML('beforeend', MOBILE_BTN);
  }

  // Remove the pretend sign-in popup (it asked for a legal name and stored nothing)
  Array.prototype.forEach.call(document.querySelectorAll('div'), function (d) {
    if (d.getAttribute('x-show') === 'authPreviewModal') d.remove();
  });

  // Alias Studio: no legal-name field and no NIN/document collection until verification is real
  var form = Array.prototype.find.call(document.querySelectorAll('form'), function (f) {
    return f.getAttribute('@submit.prevent') === 'saveAliasProfile()';
  });
  if (form) {
    var legal = form.querySelector('input[x-model="userProfile.legalName"]');
    if (legal && legal.closest('div')) legal.closest('div').remove();
    var kycTitle = Array.prototype.find.call(form.querySelectorAll('h3'), function (h) {
      return h.textContent.indexOf('Identity Verification Track') !== -1;
    });
    if (kycTitle && kycTitle.parentElement) kycTitle.parentElement.innerHTML = KYC_NOTICE;
    var submit = form.querySelector('button[type="submit"]');
    if (submit) submit.textContent = 'Save Alias Profile';
  }
  Array.prototype.forEach.call(document.querySelectorAll('p[x-text]'), function (p) {
    if ((p.getAttribute('x-text') || '').indexOf('Submit your verification credentials below') !== -1) {
      p.setAttribute('x-text', "'Identity verification opens soon. Your alias profile works now.'");
    }
  });

  /* ---------- 2. Helpers ---------- */
  var AVATARS = ['\uD83D\uDD27', '\uD83D\uDCBB', '\uD83D\uDE97', '\u2702\uFE0F', '\uD83C\uDF73', '\uD83C\uDF93'];
  function soon(msg) { return function () { this.notify('Coming soon', msg, '\uD83D\uDEA7'); }; }
  function guest() { return { registered: false, legalName: '', alias: '', avatar: AVATARS[0], bio: '' }; }

  /* ---------- 3. Wrap the Alpine component ---------- */
  window.jobterMarketplace = function () {
    var app = original();

    Object.assign(app, {
      session: null, authOpen: false, authTab: 'signup',
      authEmail: '', authPassword: '', authError: '', authInfo: '',
      authBusy: false, profileLoadedFor: null
    });

    // Remove demo identity, demo chats and demo XP
    Object.assign(app.userProfile, guest());
    app.chatThreads = [];
    app.activeChatId = null;
    app.pulseData.xp = 0;
    app.pulseData.level = 1;
    app.pulseData.nextLevelXp = 200;

    // Everything that created fake money, banks, escrow, posts or verification is switched off
    app.openFundWalletModal = soon('Wallet funding opens when real payments are connected.');
    app.submitFundWallet = soon('Wallet funding opens when real payments are connected.');
    app.openAddBankModal = soon('Bank linking opens when real payments are connected.');
    app.submitAddBank = soon('Bank linking opens when real payments are connected.');
    app.withdrawSafeLock = soon('Withdrawals open when real payments are connected.');
    app.jobterReleaseEscrow = soon('Escrow release opens when real payments are connected.');
    app.publishTask = soon('Live task posting is the next stage. Tasks shown now are demos.');
    app.finalizeTaskAcceptance = soon('Live tasks are the next stage. Demo tasks cannot be accepted.');
    app.simulateApproveVerification = soon('Identity verification is not active yet.');

    app.requireLogin = function () {
      if (this.session) return true;
      this.authOpen = true;
      return false;
    };
    app.openAuthModal = function () { this.authOpen = true; };
    app.clickPostTask = function () { if (this.requireLogin()) this.activeTab = 'post'; };
    app.openProfessionalMessenger = function () {
      if (this.requireLogin()) this.notify('Coming soon', 'Messaging opens once live tasks are available.', '\uD83D\uDEA7');
    };
    app.acceptTaskFromModal = function () {
      if (!this.requireLogin()) { this.claimModalOpen = false; return; }
      this.notify('Demo task', 'Live tasks open in the next stage, so this one cannot be accepted yet.', '\uD83D\uDEA7');
    };

    var baseInit = app.initApp;
    app.initApp = function () {
      baseInit.call(this);
      this.startAuth();
    };

    app.startAuth = function () {
      var self = this;
      sb.auth.onAuthStateChange(function (event, session) {
        // Defer: calling Supabase inside this callback can deadlock
        setTimeout(function () { self.applySession(session); }, 0);
      });
    };

    app.applySession = async function (session) {
      this.session = session;
      if (session) {
        this.authOpen = false;
        if (this.profileLoadedFor !== session.user.id) await this.loadProfile(session.user);
        this.userProfile.registered = true;
      } else {
        this.profileLoadedFor = null;
        Object.assign(this.userProfile, guest());
      }
    };

    app.loadProfile = async function (user) {
      var res = await sb.from('profiles').select('*').eq('id', user.id).maybeSingle();
      if (res.error || !res.data) {
        this.notify('Profile not found', 'Could not load your profile. Make sure the schema SQL was run, then log in again.', '\u26A0\uFE0F');
        return;
      }
      var p = res.data;
      Object.assign(this.userProfile, {
        alias: p.alias,
        avatar: AVATARS.indexOf(p.avatar) !== -1 ? p.avatar : AVATARS[0],
        bio: p.bio
      });
      this.pulseData.level = p.level;
      this.pulseData.xp = p.xp;
      this.pulseData.nextLevelXp = p.level * 200;
      this.profileLoadedFor = user.id;
      if (/^User_[0-9a-f]{8}$/.test(p.alias)) {
        this.viewMode = 'app';
        this.activeTab = 'profile';
        this.notify('Welcome to Jobter!', 'Pick your public alias, then press Save.', '\uD83C\uDFAD');
      }
    };

    app.submitAuth = async function () {
      this.authError = '';
      this.authInfo = '';
      var email = (this.authEmail || '').trim();
      var password = this.authPassword || '';
      if (!email || password.length < 8) {
        this.authError = 'Enter your email and a password of at least 8 characters.';
        return;
      }
      this.authBusy = true;
      try {
        if (this.authTab === 'signup') {
          var up = await sb.auth.signUp({ email: email, password: password });
          if (up.error) throw up.error;
          if (!up.data.session) {
            this.authTab = 'login';
            this.authInfo = 'Account created. Check your email to confirm it, then log in.';
          }
        } else {
          var inn = await sb.auth.signInWithPassword({ email: email, password: password });
          if (inn.error) throw inn.error;
        }
        this.authPassword = '';
      } catch (e) {
        this.authError = (e && e.message) ? e.message : 'Something went wrong. Please try again.';
      }
      this.authBusy = false;
    };

    app.signOut = async function () {
      await sb.auth.signOut();
      this.activeTab = 'explore';
    };

    // Alias Studio "Save" button
    app.saveAliasProfile = async function () {
      if (!this.requireLogin()) return;
      var alias = (this.userProfile.alias || '').replace(/[^a-zA-Z0-9_]/g, '');
      if (alias.length < 3 || alias.length > 24) {
        this.notify('Alias not valid', 'Use 3 to 24 letters, numbers or underscores.', '\u26A0\uFE0F');
        return;
      }
      this.userProfile.alias = alias;
      var res = await sb.from('profiles')
        .update({
          alias: alias,
          avatar: this.userProfile.avatar,
          bio: (this.userProfile.bio || '').slice(0, 280)
        })
        .eq('id', this.session.user.id)
        .select('id');
      if (res.error) {
        if (res.error.code === '23505') {
          this.notify('Alias already taken', 'Someone else is using @' + alias + '. Try another one.', '\u26A0\uFE0F');
        } else {
          this.notify('Could not save', res.error.message, '\u26A0\uFE0F');
        }
        return;
      }
      if (!res.data || res.data.length === 0) {
        this.notify('Could not save', 'Your profile was not updated. Check the schema and RLS policies.', '\u26A0\uFE0F');
        return;
      }
      this.notify('Profile saved', 'You are now @' + alias + ' on Jobter.', '\u2713');
    };

    return app;
  };
})();
