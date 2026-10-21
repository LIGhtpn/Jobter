/* ======================================================================
   JOBTER - STAGE 3: claiming + live chat (Supabase Realtime)
   Load AFTER jobter-auth.js and jobter-tasks.js, BEFORE Alpine starts:
     <script src="jobter-auth.js"></script>
     <script src="jobter-tasks.js"></script>
     <script src="jobter-chat.js"></script>
   ====================================================================== */
(function () {
  'use strict';

  var prev = window.jobterMarketplace;
  if (typeof prev !== 'function' || typeof sb === 'undefined') {
    console.error('jobter-chat.js: jobterMarketplace() or the Supabase client `sb` was not found.');
    return;
  }

  var channel = null;   // kept outside Alpine so it is not wrapped in a reactive proxy
  var TASK_SELECT = 'id,title,status,agreed_price,poster_id,jobber_id,created_at,' +
                    'poster:profiles!poster_id(alias,avatar),jobber:profiles!jobber_id(alias,avatar)';

  /* ---------- 1. Page edits (run before Alpine starts) ---------- */
  var each = function (list, fn) { Array.prototype.forEach.call(list, fn); };
  function eachEl(root, sel, fn) {            // also looks inside <template> contents
    each(root.querySelectorAll(sel), fn);
    each(root.querySelectorAll('template'), function (t) { eachEl(t.content, sel, fn); });
  }

  // No fake escrow or star ratings in the messenger
  eachEl(document, 'span[x-text]', function (el) {
    var x = el.getAttribute('x-text') || '';
    if (x.indexOf('Escrow Held') !== -1) {
      el.setAttribute('x-text', "messengerView === 'chat' ? ('Agreed budget: ' + formatNaira(currentChat?.contractAmount || 0) + ' \u2022 payments not live yet') : 'Select a conversation'");
    } else if (x.indexOf('partnerRating') !== -1) {
      el.setAttribute('x-text', "'New member'");
    }
  });
  // Remove the fake "Release Escrow" button, and the photo / voice buttons (not built yet)
  eachEl(document, 'template[x-if]', function (t) {
    if ((t.getAttribute('x-if') || '').indexOf('!currentChat.completed') !== -1) t.remove();
  });
  eachEl(document, 'label', function (l) {
    var i = l.querySelector('input[type="file"]');
    if (i && i.getAttribute('@change') === 'uploadChatPhoto($event)') l.remove();
  });
  eachEl(document, 'button', function (b) {
    if (b.getAttribute('@click') === 'sendVoiceNote()') b.remove();
  });

  // Task popup: claiming is real now, payments are not
  each(document.querySelectorAll('p'), function (p) {
    if (p.textContent.indexOf('Secure payments and messaging are not live yet') !== -1) {
      p.textContent = 'Payments are not live yet. Claiming reserves this task for you and opens a private chat with the poster. Avoid paying in advance, and never share passwords or OTP codes.';
    }
  });
  each(document.querySelectorAll('button'), function (b) {
    if (b.getAttribute('@click') === 'acceptTaskFromModal()') b.textContent = 'Claim This Task \u2192';
  });

  // Messenger sidebar: safety note and empty state
  var NOTICE = '<p class="mx-3 my-2 p-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-[10px] leading-relaxed text-amber-900 dark:text-amber-200">Payments are not live yet. Avoid paying in advance, and never share passwords or OTP codes.</p>';
  var EMPTY = '<p x-show="chatThreads.length === 0" x-cloak class="text-xs text-slate-400 text-center py-8 px-4">No conversations yet. Claim a task, or wait for someone to claim yours.</p>';
  var search = document.querySelector('input[x-model="contactSearch"]');
  if (search && search.parentElement) search.parentElement.insertAdjacentHTML('afterend', NOTICE);
  var listTpl = document.querySelector('template[x-for="chat in filteredContacts"]');
  if (listTpl && listTpl.parentElement) listTpl.parentElement.insertAdjacentHTML('afterbegin', EMPTY);

  /* ---------- 2. Helpers ---------- */
  function myId(a) { return a.session ? a.session.user.id : null; }
  function hhmm(iso) { return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
  function toMsg(m, me) {
    return { id: m.id, sender: m.sender_id === me ? 'me' : 'them', type: 'text', text: m.body, time: hhmm(m.created_at) };
  }
  function scrollChat() {
    setTimeout(function () {
      var el = document.querySelector('div[class*="overflow-y-auto"][class*="space-y-3.5"]');
      if (el) el.scrollTop = el.scrollHeight;
    }, 60);
  }

  /* ---------- 3. Wrap the Alpine component ---------- */
  window.jobterMarketplace = function () {
    var app = prev();
    app.chatThreads = [];
    app.activeChatId = null;
    app.claiming = false;

    app.uploadChatPhoto = function () { this.notify('Coming soon', 'Photo proof is coming soon.', '\uD83D\uDEA7'); };
    app.sendVoiceNote = function () { this.notify('Coming soon', 'Voice notes are coming soon.', '\uD83D\uDEA7'); };

    // Sign-in / sign-out: load chats and start (or stop) live updates
    var baseApply = app.applySession;
    app.applySession = async function (session) {
      await baseApply.call(this, session);
      if (session) {
        await this.loadThreads();
        this.subscribeRealtime();
      } else {
        this.unsubscribeRealtime();
        this.chatThreads = [];
        this.activeChatId = null;
      }
    };

    app.subscribeRealtime = function () {
      if (channel) return;
      var self = this;
      channel = sb.channel('jobter-live')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, function (p) { self.onNewMessage(p.new); })
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'tasks' }, function (p) { self.onTaskUpdate(p.new); })
        .subscribe();
    };
    app.unsubscribeRealtime = function () {
      if (channel) { sb.removeChannel(channel); channel = null; }
    };

    app.loadThreads = async function () {
      var me = myId(this);
      if (!me) { this.chatThreads = []; return; }
      var t = await sb.from('tasks').select(TASK_SELECT)
        .in('status', ['claimed', 'completed'])
        .or('poster_id.eq.' + me + ',jobber_id.eq.' + me)
        .order('created_at', { ascending: false });
      if (t.error) { this.notify('Could not load chats', t.error.message, '\u26A0\uFE0F'); return; }
      var msgs = [];
      if (t.data.length) {
        var m = await sb.from('messages').select('*')
          .in('task_id', t.data.map(function (r) { return r.id; }))
          .order('created_at', { ascending: true }).limit(1000);
        if (m.error) { this.notify('Could not load messages', m.error.message, '\u26A0\uFE0F'); return; }
        msgs = m.data;
      }
      this.chatThreads = t.data.map(function (r) {
        var iAmPoster = r.poster_id === me;
        var other = iAmPoster ? r.jobber : r.poster;
        var list = msgs.filter(function (x) { return x.task_id === r.id; });
        var last = list[list.length - 1];
        return {
          id: r.id,
          partnerAlias: other ? other.alias : 'member',
          partnerAvatar: (other && other.avatar) || '\uD83D\uDC64',
          partnerRating: 0,
          role: iAmPoster ? 'Claimed your task' : 'Task poster',
          online: false,
          completed: r.status === 'completed',
          time: last ? hhmm(last.created_at) : '',
          contractAmount: Number(r.agreed_price) || 0,
          lastMsg: last ? last.body : r.title,
          messages: list.map(function (x) { return toMsg(x, me); })
        };
      });
      if (this.activeChatId && !this.chatThreads.some(function (c) { return c.id === this.activeChatId; }, this)) {
        this.activeChatId = null;
      }
      scrollChat();
    };

    app.addMessage = function (m) {
      var me = myId(this);
      var th = this.chatThreads.find(function (c) { return c.id === m.task_id; });
      if (!th) { this.loadThreads(); return; }
      if (th.messages.some(function (x) { return x.id === m.id; })) return;   // already shown
      th.messages.push(toMsg(m, me));
      th.lastMsg = m.body;
      th.time = hhmm(m.created_at);
      scrollChat();
    };

    app.onNewMessage = function (m) {
      this.addMessage(m);
      var open = this.messengerModalOpen && this.activeChatId === m.task_id;
      if (m.sender_id !== myId(this) && !open) {
        this.notify('New message', 'You have a new message about a task.', '\uD83D\uDCAC');
      }
    };

    app.onTaskUpdate = function (t) {
      var me = myId(this);
      if (t.status !== 'open') this.tasks = this.tasks.filter(function (x) { return x.id !== t.id; });
      if (t.status === 'claimed' && t.poster_id === me) {
        this.notify('Your task was claimed', 'Open the messenger to chat with the jobber.', '\uD83E\uDD1D');
        this.loadThreads();
      }
    };

    app.openProfessionalMessenger = async function () {
      if (!this.requireLogin()) return;
      this.messengerView = 'contacts';
      this.messengerModalOpen = true;
      await this.loadThreads();
    };

    app.sendChatMessage = async function () {
      var text = (this.newChatMessage || '').trim();
      var me = myId(this);
      var th = this.currentChat;
      if (!text || !me || !th) return;
      if (text.length > 2000) { this.notify('Message too long', 'Keep messages under 2,000 characters.', '\u26A0\uFE0F'); return; }
      this.newChatMessage = '';
      var res = await sb.from('messages').insert({ task_id: th.id, sender_id: me, body: text }).select().single();
      if (res.error) {
        this.newChatMessage = text;
        this.notify('Message not sent', res.error.message, '\u26A0\uFE0F');
        return;
      }
      this.addMessage(res.data);
    };

    app.acceptTaskFromModal = async function () {
      var t = this.claimingTask;
      if (!t || this.claiming) return;
      if (!this.requireLogin()) { this.claimModalOpen = false; return; }
      if (t.isDemo) {
        this.notify('Demo task', 'This is a sample listing. Claim a task posted by a real member instead.', '\u2139\uFE0F');
        return;
      }
      var me = myId(this);
      if (t.posterId === me) { this.notify('Your own task', 'You cannot claim a task you posted.', '\u2139\uFE0F'); return; }
      var offer = Math.round(Number(this.chosenOffer) || t.minPrice);
      if (offer < t.minPrice || offer > t.maxPrice) {
        this.notify('Offer out of range', 'Pick an amount inside the poster\u2019s budget range.', '\u26A0\uFE0F');
        return;
      }
      this.claiming = true;
      var res = await sb.rpc('claim_task', { p_task_id: t.id, p_offer: offer });
      this.claiming = false;
      if (res.error) {
        this.notify('Could not claim', res.error.message, '\u26A0\uFE0F');
        this.loadTasks();
        return;
      }
      this.claimModalOpen = false;
      this.tasks = this.tasks.filter(function (x) { return x.id !== t.id; });
      await sb.from('messages').insert({
        task_id: t.id, sender_id: me,
        body: 'Hi, I have claimed "' + t.title.slice(0, 80) + '" for ' + this.formatNaira(offer) + '. Let us agree the details here.'
      });
      await this.loadThreads();
      this.activeChatId = t.id;
      this.messengerView = 'chat';
      this.messengerModalOpen = true;
      this.notify('Task claimed', 'You are now chatting with @' + t.posterAlias + '.', '\uD83E\uDD1D');
    };

    return app;
  };
})();
