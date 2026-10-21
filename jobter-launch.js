/* ======================================================================
   JOBTER - LAUNCH READINESS
   1) Honest wording: nothing promises escrow, payouts or verification as live
   2) Forgot password + set-new-password flow
   Load LAST, BEFORE Alpine starts:
     <script src="jobter-auth.js"></script>
     <script src="jobter-tasks.js"></script>
     <script src="jobter-chat.js"></script>
     <script src="jobter-launch.js"></script>
   ====================================================================== */
(function () {
  'use strict';

  var SUPPORT_EMAIL = '';   // optional, e.g. 'support@yourdomain.com' (shown in the FAQ)

  var prev = window.jobterMarketplace;
  if (typeof prev !== 'function' || typeof sb === 'undefined') {
    console.error('jobter-launch.js: jobterMarketplace() or the Supabase client `sb` was not found.');
    return;
  }

  // Catch the "password recovery" signal as early as possible. The event can fire
  // before the page finishes starting, so remember it and show the window once ready.
  var appRef = null;
  window.jobterRecovery = /type=recovery/.test(window.location.hash);
  sb.auth.onAuthStateChange(function (event) {
    if (event === 'PASSWORD_RECOVERY') {
      window.jobterRecovery = true;
      if (appRef) setTimeout(function () { appRef.showReset(); }, 0);
    }
  });

  var each = function (list, fn) { Array.prototype.forEach.call(list, fn); };
  function eachEl(root, sel, fn) {
    each(root.querySelectorAll(sel), fn);
    each(root.querySelectorAll('template'), function (t) { eachEl(t.content, sel, fn); });
  }

  /* ---------- 1. Honest wording in the page ---------- */
  var REWRITES = [
    ["Nigeria's Premier Micro-Task", "Nigeria's Micro-Task & Local Opportunities Marketplace"],
    ["Connect with vetted Nigerian artisans", "Post tasks and find local artisans, remote professionals and campus runners across Nigeria. Secure escrow payments and identity verification are coming soon."],
    ["Protected Escrow Milestone", "Escrow Protection \u2022 Coming Soon"],
    ["Task budgets are locked safely", "Escrow payments are being built. Until they launch, agree details carefully and avoid paying in advance."],
    ["Strict Identity & Alias Verification", "Identity Verification \u2022 Coming Soon"],
    ["General professionals verify with NIN", "Verification for professionals and students is planned. Today you join with an email and a public alias."],
    ["Direct Bank Payouts", "Bank Payouts \u2022 Coming Soon"],
    ["Approved earnings accumulate", "Withdrawals to Nigerian bank accounts will open together with secure payments."],
    ["Find Trusted Local Artisans", "Find Local Artisans, Campus Runners & Remote Pros Across Nigeria."],
    ["Explore actionable sample tasks", "Browse tasks across all 36 States, FCT Abuja and Remote. Post a task, claim one and chat with the other person. Escrow payments are coming soon."],
    ["Used to fund escrow", "Wallet funding opens with secure payments."],
    ["Held securely by Jobter", "Escrow opens with secure payments."],
    ["Released escrow earnings", "Earnings will appear here once payments launch."],
    ["Destination for instant NIP", "Bank linking opens with secure payments."],
    ["Simulated activity log", "Your wallet activity will appear here once payments launch."],
    ["+ Fund Wallet", "+ Fund Wallet (Coming Soon)"],
    ["Instant Payout to Linked Bank", "Withdraw (Coming Soon)"],
    ["Real verified earnings tracked", "Earnings tracking arrives with payments."],
    ["\u2713 Complete tasks and get approved", "Earnings goals arrive with payments."],
    ["Configure your public handle", "Configure your public handle, trade badge and bio."],
    ["Build your verified reputation", "Build your profile and track your progress. Rewards unlock as live tasks and payments launch."]
  ];
  eachEl(document, 'h1, h3, p, span, button, div', function (el) {
    if (el.children.length) return;   // only elements that contain plain text
    var t = el.textContent.replace(/\s+/g, ' ').replace(/\u2019/g, "'").trim();
    for (var i = 0; i < REWRITES.length; i++) {
      if (t.indexOf(REWRITES[i][0]) === 0) { el.textContent = REWRITES[i][1]; return; }
    }
  });

  var PREVIEW = '<div class="bg-amber-100 text-amber-900 text-center text-[11px] font-bold py-1.5 px-3">Early preview: payments and identity verification are coming soon.</div>';
  var WALLET_NOTE = '<div class="mb-1 p-4 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-xs text-amber-900 dark:text-amber-200 font-semibold">Payments are not live yet. Wallet funding, escrow and bank withdrawals open soon. Nothing on this page moves real money.</div>';
  document.body.insertAdjacentHTML('afterbegin', PREVIEW);
  var wallet = document.querySelector('section[x-show="activeTab === \'wallet\'"]');
  if (wallet) wallet.insertAdjacentHTML('afterbegin', WALLET_NOTE);

  /* ---------- 2. Forgot password UI ---------- */
  var INPUT = 'w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-3.5 py-3 text-sm text-jobterBlack dark:text-white focus:outline-none focus:border-jobterBlue';
  var FORGOT_BTN = '<button type="button" x-show="authTab === \'login\'" x-cloak @click="sendResetLink()" class="w-full text-xs font-bold text-jobterBlue hover:underline">Forgot password?</button>';
  var RESET_HTML =
    '<div x-show="resetOpen" x-cloak class="fixed inset-0 z-[70] bg-jobterBlack/80 backdrop-blur-sm flex items-center justify-center p-4">' +
      '<div class="bg-white dark:bg-jobterDarkCard rounded-3xl max-w-md w-full p-6 sm:p-7 border border-slate-200 dark:border-slate-800 shadow-2xl space-y-4">' +
        '<h3 class="font-extrabold text-xl text-jobterBlack dark:text-white">Set a new password</h3>' +
        '<form @submit.prevent="submitNewPassword()" class="space-y-3.5">' +
          '<input type="password" required minlength="8" autocomplete="new-password" placeholder="New password (8+ characters)" x-model="resetPassword" class="' + INPUT + '">' +
          '<input type="password" required minlength="8" autocomplete="new-password" placeholder="Repeat new password" x-model="resetConfirm" class="' + INPUT + '">' +
          '<p x-show="resetError" x-cloak class="text-xs font-semibold text-red-600" x-text="resetError"></p>' +
          '<button type="submit" :disabled="resetBusy" class="w-full bg-jobterBlue hover:bg-jobterBlueDark disabled:opacity-60 text-white font-bold text-sm py-3.5 rounded-xl transition" x-text="resetBusy ? \'Please wait...\' : \'Save new password\'"></button>' +
        '</form>' +
      '</div>' +
    '</div>';
  var authForm = Array.prototype.find.call(document.querySelectorAll('form'), function (f) {
    return f.getAttribute('@submit.prevent') === 'submitAuth()';
  });
  if (authForm) authForm.insertAdjacentHTML('afterend', FORGOT_BTN);
  document.body.insertAdjacentHTML('beforeend', RESET_HTML);

  /* ---------- 3. FAQ answers that match what is really live ---------- */
  var help = SUPPORT_EMAIL ? ' Contact ' + SUPPORT_EMAIL + '.' : '';
  var FAQ = {
    101: { a: 'Jobter is a Nigerian micro-task marketplace in early preview. People post local and remote tasks, and others claim them and chat with the poster. Secure payments and identity verification are coming soon.' },
    102: { a: 'Tasks tagged Demo are sample listings so the feed is never empty. They cannot be claimed. Tasks without the tag are posted by real members.' },
    103: { a: 'Yes. Creating an account, setting your alias and browsing tasks are free during the preview.' },
    201: { a: 'Open a task, choose your price inside the poster\u2019s budget range, then click Claim This Task. A private chat opens with the poster.' },
    203: { a: 'Tasks marked Campus are intended for university and polytechnic students running errands on campus. Student verification is coming soon.' },
    301: { a: 'Identity verification is planned before payments launch. For now you can post with an account. Do not put phone numbers, home addresses or ID numbers in task descriptions.' },
    303: { a: 'Photo proof and voice notes are coming soon. For now, chat supports text messages.' },
    401: { a: 'Escrow is not live yet. When it launches, funds will be held until the client approves the work.' },
    402: { a: 'Withdrawals are not live yet. The planned minimum is \u20A610,000.' },
    403: { a: 'Wallet funding is not live yet and will open together with escrow.' },
    501: { a: 'Verification is not live yet. The plan is for general professionals to verify with a NIN and a utility bill. Please do not send ID numbers or documents anywhere until we announce it.' },
    502: { a: 'Verification is not live yet. The plan is for students to verify with a university name, Student ID and matriculation number. Please do not send these anywhere until we announce it.' },
    503: { a: 'Your public alias protects your privacy. Other members see your alias, never your email address.' },
    601: { a: 'Ratings are not live yet. New members show as New member until reviews launch.' },
    602: { a: 'There is no formal dispute process yet because payments are not live. If something goes wrong, stop the conversation, do not send money, and report it.' + help },
    603: { a: 'Jobter Pulse is a preview. XP and badges will reward reliable members once tasks can be completed and paid on the platform.' }
  };

  /* ---------- 4. Wrap the Alpine component ---------- */
  window.jobterMarketplace = function () {
    var app = prev();

    app.faqCategories.forEach(function (g) {
      g.items.forEach(function (it) {
        var e = FAQ[it.id];
        if (e) { if (e.q) it.q = e.q; if (e.a) it.a = e.a; }
      });
    });

    // Pulse: remove claims that depend on payments
    app.pulseData.weeklyChallenge.title = 'Challenges start when tasks can be completed on Jobter.';
    app.pulseData.badges = app.pulseData.badges.filter(function (b) { return b.title !== 'Fast Responder'; });
    app.claimChallengeXp = function () { this.notify('Coming soon', 'XP rewards start with live tasks and payments.', '\uD83D\uDEA7'); };

    Object.assign(app, { resetOpen: false, resetPassword: '', resetConfirm: '', resetError: '', resetBusy: false });

    var baseInit = app.initApp;
    app.initApp = function () {
      baseInit.call(this);
      appRef = this;
      if (window.jobterRecovery) this.showReset();
    };

    app.showReset = function () {
      this.authOpen = false;
      this.resetError = '';
      this.resetOpen = true;
    };

    app.sendResetLink = async function () {
      this.authError = '';
      this.authInfo = '';
      var email = (this.authEmail || '').trim();
      if (!email) { this.authError = 'Type your email above first, then press Forgot password.'; return; }
      this.authBusy = true;
      var res = await sb.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin + window.location.pathname });
      this.authBusy = false;
      if (res.error) { this.authError = res.error.message; return; }
      this.authInfo = 'If an account exists for that email, a reset link is on its way. Check your inbox and spam folder.';
    };

    app.submitNewPassword = async function () {
      this.resetError = '';
      if (this.resetPassword.length < 8) { this.resetError = 'Use at least 8 characters.'; return; }
      if (this.resetPassword !== this.resetConfirm) { this.resetError = 'The two passwords do not match.'; return; }
      this.resetBusy = true;
      var res = await sb.auth.updateUser({ password: this.resetPassword });
      this.resetBusy = false;
      if (res.error) { this.resetError = res.error.message; return; }
      this.resetPassword = '';
      this.resetConfirm = '';
      this.resetOpen = false;
      window.jobterRecovery = false;
      this.notify('Password updated', 'You are signed in with your new password.', '\u2713');
    };

    return app;
  };
})();
