/* ======================================================================
   JOBTER - STAGE 2: real task feed + posting (Supabase)
   Load AFTER jobter-auth.js and BEFORE Alpine starts:
     <script src="jobter-auth.js"></script>
     <script src="jobter-tasks.js"></script>
   ====================================================================== */
(function () {
  'use strict';

  var KEEP_DEMOS = true;   // set to false to hide the sample "Demo" tasks
  var SELECT = '*, poster:profiles!poster_id(alias)';

  var prev = window.jobterMarketplace;
  if (typeof prev !== 'function' || typeof sb === 'undefined') {
    console.error('jobter-tasks.js: jobterMarketplace() or the Supabase client `sb` was not found.');
    return;
  }

  /* ---------- 1. Page edits (run before Alpine starts) ---------- */
  var each = function (list, fn) { Array.prototype.forEach.call(list, fn); };

  // Real members have no ratings yet, so show "New member" instead of a fake star score
  each(document.querySelectorAll('template'), function (t) {
    each(t.content.querySelectorAll('[x-text]'), function (el) {
      if ((el.getAttribute('x-text') || '').indexOf('task.posterRating') !== -1) {
        el.setAttribute('x-text', 'ratingText(task)');
      }
    });
  });
  each(document.querySelectorAll('span[x-text]'), function (el) {
    var x = el.getAttribute('x-text') || '';
    if (x.indexOf('claimingTask?.posterRating') !== -1) {
      el.setAttribute('x-text', "'@' + claimingTask?.posterAlias + ' \u2022 ' + ratingText(claimingTask)");
    }
    if (x.indexOf("'KYC: '") !== -1) el.remove();   // fake KYC badge on the Post tab
  });

  // Publishing no longer depends on the fake verification flow
  each(document.querySelectorAll('template[x-if]'), function (t) {
    if (t.getAttribute('x-if') === "userProfile.verificationStatus !== 'Verified'") t.remove();
  });

  // Task detail popup: be honest about what is live
  each(document.querySelectorAll('p'), function (p) {
    if (p.textContent.indexOf('How Jobter Works') !== -1) {
      p.textContent = 'Secure payments and messaging are not live yet. Claiming a task opens together with messaging in the next update.';
    }
  });
  each(document.querySelectorAll('button'), function (b) {
    if (b.getAttribute('@click') === 'acceptTaskFromModal()') b.textContent = 'Claiming opens soon';
  });

  /* ---------- 2. Helpers ---------- */
  function ago(iso) {
    var s = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
    if (s < 60) return 'Just now';
    var m = Math.round(s / 60);
    if (m < 60) return m + ' mins ago';
    var h = Math.round(m / 60);
    if (h < 24) return h + (h === 1 ? ' hour ago' : ' hours ago');
    var d = Math.round(h / 24);
    return d + (d === 1 ? ' day ago' : ' days ago');
  }

  function mapRow(r) {
    return {
      id: r.id, title: r.title, description: r.description,
      state: r.state, location: r.location, category: r.category,
      posterId: r.poster_id, posterAlias: r.poster ? r.poster.alias : 'member',
      posterRating: 0, posterRatingCount: 0,
      campusOnly: !!r.campus_only, isRemote: r.mode === 'Remote',
      postedTime: ago(r.created_at),
      minPrice: Number(r.min_price), maxPrice: Number(r.max_price),
      isDemo: false
    };
  }

  /* ---------- 3. Wrap the Alpine component ---------- */
  window.jobterMarketplace = function () {
    var app = prev();
    app.demoTasks = app.tasks.slice();
    app.publishing = false;

    app.ratingText = function (t) {
      if (!t) return '';
      return t.posterRatingCount ? '\u2605 ' + t.posterRating + ' (' + t.posterRatingCount + ')' : 'New member';
    };

    var baseInit = app.initApp;
    app.initApp = function () {
      baseInit.call(this);
      this.loadTasks();
    };

    app.loadTasks = async function () {
      var res = await sb.from('tasks').select(SELECT)
        .eq('status', 'open').order('created_at', { ascending: false }).limit(100);
      if (res.error) {
        this.notify('Could not load tasks', res.error.message, '\u26A0\uFE0F');
        return;
      }
      var live = res.data.map(mapRow);
      this.tasks = KEEP_DEMOS ? live.concat(this.demoTasks) : live;
    };

    app.publishTask = async function () {
      if (!this.requireLogin() || this.publishing) return;
      var f = this.postForm;
      var title = (f.title || '').trim();
      var desc = (f.description || '').trim();
      var loc = (f.location || '').trim();
      var min = Number(f.minPrice);
      var max = Number(f.maxPrice);
      if (title.length < 5 || desc.length < 10 || !loc) {
        this.notify('Add more detail', 'Use a clear title (5+ characters), a description (10+ characters) and an area.', '\u26A0\uFE0F');
        return;
      }
      if (!(min >= 1000) || max < min) {
        this.notify('Check your budget', 'The minimum must be at least \u20A61,000 and the maximum cannot be lower than the minimum.', '\u26A0\uFE0F');
        return;
      }
      this.publishing = true;
      var res = await sb.from('tasks').insert({
        poster_id: this.session.user.id,
        title: title,
        description: desc,
        state: f.isRemote ? 'Remote' : f.state,
        location: loc,
        category: f.category,
        campus_only: !!f.campusOnly,
        min_price: min,
        max_price: max
      }).select(SELECT).single();
      this.publishing = false;
      if (res.error) {
        this.notify('Could not publish', res.error.message, '\u26A0\uFE0F');
        return;
      }
      this.tasks.unshift(mapRow(res.data));
      f.title = '';
      f.location = '';
      f.description = '';
      this.notify('Task published', 'Your task is now live on the marketplace feed.', '\uD83D\uDE80');
      this.activeTab = 'explore';
    };

    // Claiming ships together with messaging in stage 3
    app.acceptTaskFromModal = function () {
      var t = this.claimingTask;
      if (!this.requireLogin()) { this.claimModalOpen = false; return; }
      if (t && t.posterId && t.posterId === this.session.user.id) {
        this.notify('Your own task', 'You cannot claim a task you posted.', '\u2139\uFE0F');
        return;
      }
      this.notify('Claiming opens soon', 'Claiming and messaging launch together in the next update.', '\uD83D\uDEA7');
    };

    return app;
  };
})();
