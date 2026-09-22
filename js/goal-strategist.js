/* ═══════════════════════════════════════════════════════════════
   goal-strategist.js — VISION Universal Goal Engine
   ---------------------------------------------------------------
   Turns ANY free-text goal into a deterministic coaching blueprint:
   analysis → blueprint → daily strategy → 3 guided assignments with
   exact proof requirements. Pure vanilla JS, no build, no network.

   Designed to be swapped for a server-side AI planner later WITHOUT
   touching callers: generateStrategy() checks AI_PROVIDER_ENABLED and
   otherwise returns the deterministic plan. NEVER call AI from here,
   NEVER embed secrets — the AI branch is a server endpoint slot only.

   Security note: this module only *describes* tasks/XP. XP is still
   awarded solely by the backend submit_proof RPC (no photo = no XP).
   base_xp here is advisory; the server clamps it by difficulty.

   Public API: window.VISION.goal
═══════════════════════════════════════════════════════════════ */
window.VISION = window.VISION || {};

(function (V) {
  'use strict';

  var AI_PROVIDER_ENABLED = false;   // flip ON only with a server-side planner

  /* difficulty → advisory base XP (server re-clamps to these exact values) */
  var XP_BY_DIFF = { easy: 20, core: 40, hard: 60 };

  /* ---------- helpers ---------- */
  function clean(s) { return String(s == null ? '' : s).toLowerCase().trim(); }
  function has(t, re) { return re.test(t); }
  function cap(s) { s = String(s || ''); return s.charAt(0).toUpperCase() + s.slice(1); }
  // deterministic day-indexed pick so plans are stable per day but vary over time
  function pickByDay(arr, dayIndex, salt) {
    if (!arr || !arr.length) return null;
    var i = (Math.abs((dayIndex | 0) + (salt | 0)) % arr.length);
    return arr[i];
  }
  function todayStr() { try { return new Date().toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' }); } catch (e) { return new Date().toISOString().slice(0, 10); } }

  /* ═══════════════════════════════════════════════════════════════
     DOMAIN MODEL — 15 domains. Each maps to a legacy parentPath
     (fitness|study|money|discipline) so leaderboard/scores/ranks stay
     intact, but carries its own identity, habits, proof standard and
     three role-tasks (core / friction / proof) with full coaching.
  ═══════════════════════════════════════════════════════════════ */

  // shared safe-proof helpers
  var SAFE_REFLECTION = 'A written reflection, checklist, or note you made today — no photos of other people, nothing private.';

  var DOMAINS = {
    education: {
      label: 'Education', parentPath: 'study', identity: 'The Scholar',
      mission: 'Build the reading, recall and focus that move your grades and knowledge forward.',
      dailyRule: 'One focused study or recall proof before entertainment.',
      habits: ['focused study', 'active recall', 'phone-free focus', 'review'],
      proofStandard: 'Proof must show completed work — notes, flashcards, a past-paper answer, or a book/laptop with visible work done.',
      whyStuck: 'Studying feels endless because it has no finish line — VISION turns it into one provable block a day.',
      milestones: ['First focused study streak', 'A weekly revision rhythm', 'Consistent top-effort proof'],
      tasks: {
        core: { key: 'study-sprint', title: 'Study Sprint', difficulty: 'core', minutes: '30–45 min',
          steps: ['Pick one subject and one clear piece of work.', 'Phone in another room or on Do Not Disturb.', 'Set a 30–45 min timer.', 'Work on only that one thing.', 'Photograph the completed work.'],
          why: 'Trains deep focus before motivation fades.', helps: 'Builds the focus habit and real evidence you studied.',
          proof_prompt: 'Photograph the work you just completed.',
          proof_must_show: 'Completed notes, solved questions, flashcards, or a finished page of work.',
          proof_reject_if: 'It is just a tidy desk, a blank page, or a page you only highlighted.',
          good_proof_examples: ['Filled page of worked problems', 'A stack of written flashcards', 'A past-paper question answered in pen'] },
        friction: { key: 'phone-free', title: 'Phone-Free Block', difficulty: 'easy', minutes: '30–60 min',
          steps: ['Put your phone out of reach.', 'Start one task before checking any message.', 'Keep it away for the whole block.', 'Photograph your phone-free setup or the work done.'],
          why: 'High screen time narrows your focus window — this trains control first.', helps: 'Cuts the distraction loop that feeds procrastination.',
          proof_prompt: 'Show your phone-free work session.',
          proof_must_show: 'Your work setup with the phone clearly away, or the work finished in the block.',
          proof_reject_if: 'The phone is in the shot beside the work.',
          good_proof_examples: ['Desk with work open and phone in a drawer', 'Finished work from the block'] },
        proof: { key: 'recall-proof', title: 'Recall Proof', difficulty: 'hard', minutes: '40–60 min',
          steps: ['Pick a topic you will be tested on.', 'Close your notes.', 'Write answers / flashcards from memory.', 'Check and correct mistakes.', 'Photograph the corrected recall.'],
          why: 'Active recall is what actually moves grades — not re-reading.', helps: 'Locks knowledge in and exposes gaps early.',
          proof_prompt: 'Photograph your from-memory recall, with corrections visible.',
          proof_must_show: 'Answers produced from memory, then checked/corrected.',
          proof_reject_if: 'It is a re-read or highlighted page with no recall.',
          good_proof_examples: ['Past-paper answer with red-pen corrections', 'Self-tested flashcards marked right/wrong'] }
      }
    },

    career: {
      label: 'Career', parentPath: 'study', identity: 'The Professional',
      mission: 'Build the skills, reading and applications that move you toward the role you want.',
      dailyRule: 'One concrete step toward the role before entertainment.',
      habits: ['skill study', 'applications/outreach', 'communication practice', 'consistency'],
      proofStandard: 'Proof must show a real step: study notes, a practice answer, an application sent, or a skill output created.',
      whyStuck: 'The goal feels far away, so days pass with no visible move — VISION makes one provable step the whole job.',
      milestones: ['First week of daily steps', 'First application / real output', 'A repeatable weekly routine'],
      tasks: {
        core: { key: 'role-study', title: 'Role Study Block', difficulty: 'core', minutes: '30–45 min',
          steps: ['Pick one skill or topic the role requires.', 'Study or practise one specific piece.', 'Make something you can show: notes, a summary, a worked answer.', 'Photograph the completed work.'],
          why: 'The role is built from repeated skill reps, not one big leap.', helps: 'Turns a vague ambition into daily measurable progress.',
          proof_prompt: 'Photograph the study/practice you completed.',
          proof_must_show: 'Notes, a summary, or a worked practice answer toward the role.',
          proof_reject_if: 'It is a video you only watched with nothing produced.',
          good_proof_examples: ['Case notes', 'A practice interview answer written out', 'A summarised chapter'] },
        friction: { key: 'phone-free', title: 'Phone-Free Focus', difficulty: 'easy', minutes: '30–45 min',
          steps: ['Phone out of reach.', 'Start the first step before any scrolling.', 'One block, no switching.', 'Photograph the focused setup or the result.'],
          why: 'Distraction is the gap between wanting the role and working toward it.', helps: 'Protects the focus the work needs.',
          proof_prompt: 'Show your distraction-free work block.',
          proof_must_show: 'Work in progress with the phone away.',
          proof_reject_if: 'No work is visible.',
          good_proof_examples: ['Workspace set up, phone away', 'Output from the block'] },
        proof: { key: 'forward-action', title: 'One Forward Action', difficulty: 'hard', minutes: '20–40 min',
          steps: ['Pick one real move: an application, an email, a practice answer, an outreach message.', 'Make it specific to a real place or person.', 'Send or finish it today.', 'Screenshot the sent action or finished output.'],
          why: 'One real action beats a week of planning.', helps: 'Creates momentum and real shots at the role.',
          proof_prompt: 'Screenshot the action you took.',
          proof_must_show: 'A sent application/message or a finished output.',
          proof_reject_if: 'It is drafted but unsent, or generic with no target.',
          good_proof_examples: ['Submitted application confirmation', 'A sent outreach email', 'A finished practice answer'] }
      }
    },

    business: {
      label: 'Business', parentPath: 'money', identity: 'The Builder',
      mission: 'Create and ship one visible output every day until the business is real.',
      dailyRule: 'Create or send one visible output every day.',
      habits: ['build/ship', 'outreach', 'offer refinement', 'delivery'],
      proofStandard: 'Proof must show output you made or sent: a built section, a sent message, a client list, an offer, a design.',
      whyStuck: 'You are consuming business content instead of producing — VISION forces one shipped thing a day.',
      milestones: ['First shipped output', 'First outreach batch sent', 'First real opportunity / client conversation'],
      tasks: {
        core: { key: 'build-output', title: 'Build One Output', difficulty: 'hard', minutes: '45–60 min',
          steps: ['Pick one piece: a page, an offer, a design, a feature.', 'Build the smallest complete version today.', 'Save / publish it.', 'Screenshot the output.'],
          why: 'A business is a stack of shipped outputs, not plans.', helps: 'Turns effort into visible assets you can sell.',
          proof_prompt: 'Screenshot the thing you built today.',
          proof_must_show: 'A real output: a built section, a written offer, a design, a draft.',
          proof_reject_if: 'It is a course you watched or notes about building, not the build.',
          good_proof_examples: ['A finished landing-page section', 'A written one-line offer', 'A design exported'] },
        friction: { key: 'outreach', title: 'Send 3 Messages', difficulty: 'easy', minutes: '15–25 min',
          steps: ['List 3 real people/leads.', 'Send a short, specific message to each.', 'Keep it human, not salesy.', 'Screenshot the sent messages.'],
          why: 'Sales is a numbers habit — small daily reps compound.', helps: 'Builds the outreach muscle most builders avoid.',
          proof_prompt: 'Screenshot the 3 messages you sent.',
          proof_must_show: 'Three real sent messages (recipients/platform visible).',
          proof_reject_if: 'They are drafts, or sent to nobody real.',
          good_proof_examples: ['3 DMs sent', '3 cold emails in the sent folder'] },
        proof: { key: 'sharpen-offer', title: 'Sharpen The Offer', difficulty: 'core', minutes: '20–30 min',
          steps: ['Write who it is for and the result they get.', 'Cut it to one clear sentence.', 'Note the price or next step.', 'Photograph or screenshot the offer.'],
          why: 'A sharp offer makes everything else easier to sell.', helps: 'Clarifies the business so outreach converts.',
          proof_prompt: 'Show your written offer.',
          proof_must_show: 'A one-sentence offer with who/result.',
          proof_reject_if: 'It is vague or copied with no specifics.',
          good_proof_examples: ['"I help X get Y in Z" written out', 'An offer + price noted'] }
      }
    },

    money: {
      label: 'Money', parentPath: 'money', identity: 'The Saver',
      mission: 'Build daily awareness and one income or saving action toward your number.',
      dailyRule: 'Track honestly and take one money-positive action.',
      habits: ['tracking', 'saving/no-spend', 'income action', 'awareness'],
      proofStandard: 'Proof must show a real log dated today, a no-spend note, or an income action taken — never share full account numbers.',
      sensitive: true,
      whyStuck: 'Money feels stressful so it gets avoided — VISION replaces avoidance with one honest daily action.',
      milestones: ['First tracking streak', 'First no-spend / saving win', 'First income action'],
      tasks: {
        core: { key: 'save-track', title: 'Track & Save', difficulty: 'core', minutes: '10–15 min',
          steps: ['Open your bank or a notes app.', 'Log today’s spending, a saving, or a no-spend day.', 'Note one number to improve.', 'Screenshot the log (hide account numbers).'],
          why: 'Awareness is the first money habit — tracking beats guessing.', helps: 'Builds the awareness every other decision rests on.',
          proof_prompt: 'Screenshot your money log for today.',
          proof_must_show: 'A real entry dated today — a saving, spend log, or no-spend note.',
          proof_reject_if: 'Numbers are invented, or it is an old screenshot.',
          good_proof_examples: ['A savings-app entry', 'A no-spend note dated today', 'A simple expense list'] },
        friction: { key: 'cut-leak', title: 'Cut One Leak', difficulty: 'easy', minutes: '10 min',
          steps: ['Find one unnecessary spend or subscription.', 'Cancel, pause, or set a limit.', 'Note what you saved.', 'Screenshot the change.'],
          why: 'Plugging one leak is faster than earning it back.', helps: 'Builds the habit of defending your money.',
          proof_prompt: 'Show the leak you cut.',
          proof_must_show: 'A cancelled/paused subscription or a set limit.',
          proof_reject_if: 'Nothing actually changed.',
          good_proof_examples: ['A cancellation confirmation', 'A spending limit set in an app'] },
        proof: { key: 'income-action', title: 'One Income Action', difficulty: 'hard', minutes: '20–40 min',
          steps: ['Pick one: sell something, send an invoice, list a service, pick up a shift, apply for paid work.', 'Take the action today.', 'Capture proof of it.'],
          why: 'Saving has a floor; earning does not.', helps: 'Builds the habit of creating income, not just cutting cost.',
          proof_prompt: 'Screenshot your income action.',
          proof_must_show: 'A listing posted, invoice sent, item sold, or paid-work applied.',
          proof_reject_if: 'It was only considered, not done.',
          good_proof_examples: ['A marketplace listing live', 'A sent invoice', 'A shift picked up'] }
      },
      note: 'General money habits only — not personalised investment or financial advice.'
    },

    fitness: {
      label: 'Fitness', parentPath: 'fitness', identity: 'The Athlete',
      mission: 'Make training and recovery non-negotiable, proven daily.',
      dailyRule: 'Finish the session — consistency over intensity — then prove it.',
      habits: ['training', 'movement', 'recovery', 'consistency'],
      proofStandard: 'Proof must show training evidence: workout notes, equipment, a fitness-app screen, or kit after a real session.',
      whyStuck: 'You wait to feel motivated — VISION proves that finishing beats perfecting.',
      milestones: ['First training streak', 'A weekly volume target', 'Athlete-level consistency'],
      tasks: {
        core: { key: 'workout-proof', title: 'Training Session', difficulty: 'core', minutes: '20–45 min',
          steps: ['Choose gym, run, sport, or a home workout.', 'Train at least 20 minutes.', 'Just finish the session.', 'Take proof after training.'],
          why: 'Your goal needs reps, not one perfect session.', helps: 'Builds consistency, energy and discipline that compound.',
          proof_prompt: 'Photograph your post-session proof.',
          proof_must_show: 'Workout notes, equipment used, a running-app screen, or kit after training.',
          proof_reject_if: 'It is an old photo or a generic mirror selfie.',
          good_proof_examples: ['A logged workout in an app', 'Gym equipment you just used', 'A run summary'] },
        friction: { key: 'recovery', title: 'Recovery Prep', difficulty: 'easy', minutes: '10–20 min',
          steps: ['Pick one: stretch, mobility, hydration, or an early wind-down.', 'Spend 10–20 minutes on it.', 'Keep the phone out of the bedroom tonight if you can.', 'Photograph the recovery action.'],
          why: 'Recovery is where training turns into results.', helps: 'Raises tomorrow’s energy and session quality.',
          proof_prompt: 'Show your recovery action.',
          proof_must_show: 'A stretch/mobility setup, water intake, or a wind-down log from today.',
          proof_reject_if: 'No real recovery action is shown.',
          good_proof_examples: ['A stretch setup', 'A filled water bottle log', 'A sleep wind-down note'] },
        proof: { key: 'hit-steps', title: 'Hit Your Steps', difficulty: 'easy', minutes: 'Across the day',
          steps: ['Aim for 8,000+ steps.', 'Walk after a meal or take the long route.', 'Check your phone/watch count.', 'Screenshot the total once you hit it.'],
          why: 'Daily movement holds your baseline between sessions.', helps: 'Protects momentum on non-training days.',
          proof_prompt: 'Screenshot today’s step count at 8,000+.',
          proof_must_show: 'Today’s date and the step total both visible.',
          proof_reject_if: 'It is a past day’s total.',
          good_proof_examples: ['A step-counter screen at 8k+ dated today'] }
      }
    },

    sport: {
      label: 'Sport', parentPath: 'fitness', identity: 'The Competitor',
      mission: 'Sharpen skill, conditioning and recovery with daily proven reps.',
      dailyRule: 'One skill rep and one conditioning rep, proven.',
      habits: ['skill drills', 'conditioning', 'recovery', 'match review'],
      proofStandard: 'Proof must show real practice: a drill done, training kit/ball, a session note, or a fitness-app screen.',
      whyStuck: 'Game-day improvement comes from boring daily reps most people skip — VISION makes them provable.',
      milestones: ['First skill-drill streak', 'A measurable conditioning gain', 'Consistent match-ready routine'],
      tasks: {
        core: { key: 'skill-drill', title: 'Skill Drill Block', difficulty: 'core', minutes: '20–40 min',
          steps: ['Pick one skill to sharpen (control, shooting, passing, footwork…).', 'Do focused reps, not a kickabout.', 'Note reps or sets done.', 'Photograph the drill setup or your notes.'],
          why: 'Skill is built by repetition under focus.', helps: 'Turns raw effort into measurable technical gains.',
          proof_prompt: 'Show your skill drill.',
          proof_must_show: 'Training kit/ball, a drill setup, or notes of the reps done.',
          proof_reject_if: 'It is an unrelated or old photo.',
          good_proof_examples: ['Ball + cones set up', 'A drill rep count noted', 'Boots/kit after practice'] },
        friction: { key: 'recovery', title: 'Recovery & Mobility', difficulty: 'easy', minutes: '10–20 min',
          steps: ['Stretch or do mobility for the muscles you use most.', 'Hydrate and plan tonight’s sleep.', 'Photograph the recovery action.'],
          why: 'Recovery prevents the injuries that stall progress.', helps: 'Keeps you training week after week.',
          proof_prompt: 'Show your recovery work.',
          proof_must_show: 'A mobility/stretch setup or hydration/sleep prep.',
          proof_reject_if: 'No recovery action shown.',
          good_proof_examples: ['A stretch/foam-roll setup', 'A hydration log'] },
        proof: { key: 'conditioning', title: 'Conditioning Rep', difficulty: 'core', minutes: '15–30 min',
          steps: ['Pick one: sprints, runs, circuits, or sport-specific fitness.', 'Complete the set.', 'Log it.', 'Screenshot or photograph the conditioning proof.'],
          why: 'Conditioning decides who lasts the full game.', helps: 'Builds the engine your skill runs on.',
          proof_prompt: 'Show your conditioning session.',
          proof_must_show: 'A run/circuit logged or notes of the set done today.',
          proof_reject_if: 'It is an old or unrelated screen.',
          good_proof_examples: ['A sprint session logged', 'A circuit written and ticked off'] }
      }
    },

    discipline: {
      label: 'Discipline', parentPath: 'discipline', identity: 'The Operator',
      mission: 'Remove friction and prove one protected deep-work rep a day.',
      dailyRule: 'Make starting easy, then take one protected rep.',
      habits: ['deep work', 'environment reset', 'planning', 'self-control'],
      proofStandard: 'Proof must show a real result: completed focused work, a reset space, or a written plan.',
      whyStuck: 'Discipline leaks at the moment of starting — VISION lowers that friction and proves one rep.',
      milestones: ['First discipline streak', 'A two-week control rhythm', 'A self-run operating system'],
      tasks: {
        core: { key: 'deep-work', title: 'Deep Work Block', difficulty: 'core', minutes: '60–90 min',
          steps: ['Choose the one task that matters most.', 'Phone away, tabs closed.', 'Set a 60–90 min block.', 'Work only on that task.', 'Photograph the completed work.'],
          why: 'Self-control is a muscle — one protected block trains it.', helps: 'Builds focus that carries into every goal.',
          proof_prompt: 'Photograph the work you finished in the block.',
          proof_must_show: 'A finished piece of focused work.',
          proof_reject_if: 'It is just a setup with nothing completed.',
          good_proof_examples: ['A completed report/section', 'Solved problems', 'A finished deliverable'] },
        friction: { key: 'reset', title: 'Environment Reset', difficulty: 'easy', minutes: '10–15 min',
          steps: ['Pick your desk, room, or workspace.', 'Reset it for 10–15 minutes.', 'Clear what’s not needed; set out what is.', 'Photograph the reset space.'],
          why: 'Your environment shapes behaviour — a clear space lowers the friction to start.', helps: 'Makes tomorrow’s deep work easy to begin.',
          proof_prompt: 'Show the reset, ready-to-work space.',
          proof_must_show: 'A genuinely cleared, ready space (before/after is ideal).',
          proof_reject_if: 'Nothing actually changed.',
          good_proof_examples: ['A cleared desk', 'A before/after of the space'] },
        proof: { key: 'plan-tomorrow', title: 'Plan Tomorrow', difficulty: 'easy', minutes: '5–10 min',
          steps: ['Write your top 3 for tomorrow.', 'Make the first small enough to start.', 'Set when and where.', 'Photograph the written plan.'],
          why: 'Deciding tonight removes tomorrow’s hesitation.', helps: 'Cuts procrastination and automates the start.',
          proof_prompt: 'Photograph your written top-3 plan.',
          proof_must_show: 'Three clear, specific tasks for tomorrow.',
          proof_reject_if: 'It is vague goals or a 10-item wish-list.',
          good_proof_examples: ['A handwritten top-3', 'A planner with 3 specific tasks'] }
      }
    },

    productivity: {
      label: 'Productivity', parentPath: 'discipline', identity: 'The Operator',
      mission: 'Reclaim wasted time and prove one focused output a day.',
      dailyRule: 'Cut one time-leak, then prove one focused output.',
      habits: ['time-blocking', 'distraction control', 'single-tasking', 'review'],
      proofStandard: 'Proof must show focused output or a real change to your setup — completed work or a controlled environment.',
      whyStuck: 'Time leaks through small distractions — VISION makes you close one and prove one focused block.',
      milestones: ['First focused streak', 'A weekly time-block routine', 'A reliable focus system'],
      tasks: {
        core: { key: 'deep-work', title: 'Focused Output Block', difficulty: 'core', minutes: '45–90 min',
          steps: ['Pick the highest-value task.', 'Block 45–90 min, distractions off.', 'Single-task to a finish.', 'Photograph the completed output.'],
          why: 'Focused output is the only thing that beats busywork.', helps: 'Trains single-tasking and produces real results.',
          proof_prompt: 'Photograph what you finished.',
          proof_must_show: 'A completed piece of focused work.',
          proof_reject_if: 'It is multitasked scraps with nothing finished.',
          good_proof_examples: ['A finished task/deliverable', 'A completed section of work'] },
        friction: { key: 'kill-distraction', title: 'Kill One Distraction', difficulty: 'easy', minutes: '5–10 min',
          steps: ['Find your biggest time-leak (an app, notifications, a tab habit).', 'Block, mute, or remove it.', 'Photograph the change.'],
          why: 'Removing the trigger beats resisting it all day.', helps: 'Permanently lowers daily distraction.',
          proof_prompt: 'Show the distraction you removed.',
          proof_must_show: 'A muted/blocked app or a turned-off notification setting.',
          proof_reject_if: 'Nothing was actually changed.',
          good_proof_examples: ['An app limit set', 'Notifications turned off in settings'] },
        proof: { key: 'plan-tomorrow', title: 'Plan Tomorrow’s 3', difficulty: 'easy', minutes: '5–10 min',
          steps: ['Write tomorrow’s top 3.', 'Time-block the first one.', 'Photograph the plan.'],
          why: 'A planned day resists distraction by default.', helps: 'Makes focused time the path of least resistance.',
          proof_prompt: 'Photograph your top-3 + time-block.',
          proof_must_show: 'Three specific tasks with at least one time-blocked.',
          proof_reject_if: 'It is vague or unscheduled.',
          good_proof_examples: ['A time-blocked top-3'] }
      }
    },

    'skill-learning': {
      label: 'Skill Learning', parentPath: 'study', identity: 'The Apprentice',
      mission: 'Learn by doing — one practised, produced rep of the skill a day.',
      dailyRule: 'Practise by producing, not just watching.',
      habits: ['deliberate practice', 'producing output', 'review', 'consistency'],
      proofStandard: 'Proof must show output you produced — a played piece, written code, a drawing, a recording, or practice notes.',
      whyStuck: 'Watching tutorials feels like progress but isn’t — VISION makes you produce a rep and prove it.',
      milestones: ['First practice streak', 'First produced piece', 'A repeatable practice routine'],
      tasks: {
        core: { key: 'practice-rep', title: 'Deliberate Practice', difficulty: 'core', minutes: '20–40 min',
          steps: ['Pick one specific sub-skill to practise.', 'Practise it deliberately, slowly, correctly.', 'Produce a small rep you can show.', 'Photograph or record the practice.'],
          why: 'Skill grows from focused reps on the hard part, not easy repetition.', helps: 'Builds real ability, not just familiarity.',
          proof_prompt: 'Show your practice rep.',
          proof_must_show: 'Practice output: a recording, written work, code, a sketch, or rep notes.',
          proof_reject_if: 'It is a tutorial you watched with nothing produced.',
          good_proof_examples: ['A short practice recording', 'A page of practised work', 'A code snippet you wrote'] },
        friction: { key: 'setup-practice', title: 'Remove One Barrier', difficulty: 'easy', minutes: '5–15 min',
          steps: ['Find what stops you starting (gear not out, no clear next step).', 'Set it up so tomorrow is frictionless.', 'Photograph the ready setup.'],
          why: 'Most missed practice is a setup problem, not a willpower one.', helps: 'Makes the next session automatic.',
          proof_prompt: 'Show your ready-to-practise setup.',
          proof_must_show: 'Your instrument/tools/workspace set up to start.',
          proof_reject_if: 'Nothing is actually set up.',
          good_proof_examples: ['Guitar out on a stand with a clear next exercise', 'IDE open to the next exercise'] },
        proof: { key: 'review-progress', title: 'Review & Note', difficulty: 'easy', minutes: '5–10 min',
          steps: ['Note what improved and what to fix next.', 'Write the single next focus.', 'Photograph the note.'],
          why: 'Reviewing turns reps into directed progress.', helps: 'Keeps practice pointed at your weak spot.',
          proof_prompt: 'Show your practice note.',
          proof_must_show: 'A written note of progress + next focus.',
          proof_reject_if: 'It is blank or generic.',
          good_proof_examples: ['"Fixed chord changes; next: timing" written out'] }
      }
    },

    creativity: {
      label: 'Creativity', parentPath: 'money', identity: 'The Maker',
      mission: 'Make something small and finished every day.',
      dailyRule: 'Finish one small thing rather than plan a big one.',
      habits: ['daily making', 'finishing', 'sharing', 'iteration'],
      proofStandard: 'Proof must show something you created today — a sketch, a paragraph, a track, a design, a draft.',
      whyStuck: 'Perfectionism stalls creators — VISION rewards finishing small over planning big.',
      milestones: ['First making streak', 'First finished piece', 'A consistent creative output rhythm'],
      tasks: {
        core: { key: 'make-thing', title: 'Make One Thing', difficulty: 'core', minutes: '30–45 min',
          steps: ['Pick one small piece you can finish today.', 'Make it start-to-finish, imperfect is fine.', 'Save it.', 'Photograph or screenshot the finished piece.'],
          why: 'Finishing small builds the muscle perfectionism blocks.', helps: 'Creates a body of work, one piece at a time.',
          proof_prompt: 'Show the thing you finished.',
          proof_must_show: 'A created piece: a sketch, paragraph, track, design, or draft.',
          proof_reject_if: 'It is references you saved or a blank canvas.',
          good_proof_examples: ['A finished sketch', 'A written paragraph', 'An exported design'] },
        friction: { key: 'kill-distraction', title: 'Clear To Create', difficulty: 'easy', minutes: '5–10 min',
          steps: ['Remove one block (notifications, clutter, indecision).', 'Set out your tools / open the file.', 'Photograph the ready creative space.'],
          why: 'Creativity needs a clear runway, not more inspiration.', helps: 'Removes the excuse that stops you starting.',
          proof_prompt: 'Show your ready creative setup.',
          proof_must_show: 'Tools/file open and ready to make.',
          proof_reject_if: 'Nothing is set up.',
          good_proof_examples: ['Sketchbook open with pens out', 'A blank project file opened and named'] },
        proof: { key: 'ship-share', title: 'Ship Or Save', difficulty: 'core', minutes: '10–20 min',
          steps: ['Take one finished piece.', 'Export, post, or save it to your collection.', 'Screenshot the shipped/saved piece.'],
          why: 'Shipping closes the loop and beats hoarding drafts.', helps: 'Builds a visible portfolio over time.',
          proof_prompt: 'Show the piece you shipped or saved.',
          proof_must_show: 'A finished piece exported, posted, or filed.',
          proof_reject_if: 'It stays an unfinished draft.',
          good_proof_examples: ['A posted piece', 'An exported final file'] }
      }
    },

    content: {
      label: 'Content', parentPath: 'money', identity: 'The Creator',
      mission: 'Publish consistently — one piece made and shipped on a schedule.',
      dailyRule: 'Make or ship one piece toward your channel every day.',
      habits: ['ideation', 'creating', 'publishing', 'consistency'],
      proofStandard: 'Proof must show content work: a script, a recorded clip, an edit, a thumbnail, or a published post.',
      whyStuck: 'You wait for the perfect video — VISION rewards publishing reps over perfect ones.',
      milestones: ['First publishing streak', 'First batch of pieces', 'A repeatable content cadence'],
      tasks: {
        core: { key: 'make-content', title: 'Create One Piece', difficulty: 'hard', minutes: '40–60 min',
          steps: ['Pick one piece: a script, a clip, an edit, or a post.', 'Make the smallest complete version.', 'Save it.', 'Screenshot the content you made.'],
          why: 'Channels grow from volume of reps, not one viral hope.', helps: 'Builds a publishing habit and a content library.',
          proof_prompt: 'Show the content you created.',
          proof_must_show: 'A script, recorded clip, edit, thumbnail, or draft post.',
          proof_reject_if: 'It is other people’s content you watched.',
          good_proof_examples: ['A written script', 'A recorded clip', 'An edit in progress', 'A finished thumbnail'] },
        friction: { key: 'idea-bank', title: 'Bank 3 Ideas', difficulty: 'easy', minutes: '10–15 min',
          steps: ['Write 3 specific content ideas with a hook each.', 'Pick tomorrow’s one.', 'Photograph the idea list.'],
          why: 'Never start from a blank page — a stocked idea bank removes friction.', helps: 'Keeps the pipeline full so you never miss a day.',
          proof_prompt: 'Show your 3 ideas with hooks.',
          proof_must_show: 'Three specific ideas, each with a hook/angle.',
          proof_reject_if: 'They are vague one-word topics.',
          good_proof_examples: ['3 titles + hooks written out'] },
        proof: { key: 'ship-post', title: 'Ship Or Schedule', difficulty: 'core', minutes: '15–30 min',
          steps: ['Take a finished piece.', 'Publish it or schedule it.', 'Screenshot the published/scheduled post.'],
          why: 'Published reps are the only ones that grow a channel.', helps: 'Turns work into a public, compounding body of content.',
          proof_prompt: 'Show your published or scheduled piece.',
          proof_must_show: 'A post live or queued (platform visible).',
          proof_reject_if: 'It stays unpublished on your device.',
          good_proof_examples: ['A published post', 'A scheduled upload screen'] }
      }
    },

    'social-confidence': {
      label: 'Confidence', parentPath: 'discipline', identity: 'The Speaker',
      mission: 'Grow confidence through small, repeated social reps with safe proof.',
      dailyRule: 'Complete one small social rep and prove it with reflection or evidence.',
      habits: ['exposure reps', 'communication', 'reflection', 'preparation'],
      proofStandard: 'Proof can be a written reflection, a checklist, a voice-note screenshot, or a safe evidence note. Never photos of other people.',
      sensitive: true,
      whyStuck: 'Confidence grows from exposure, not from waiting to feel ready — VISION makes the reps small and safe.',
      milestones: ['First exposure streak', 'A harder social rep cleared', 'A steady, calmer baseline'],
      tasks: {
        core: { key: 'social-rep', title: 'One Social Rep', difficulty: 'core', minutes: '5–20 min',
          steps: ['Pick one small rep: start a conversation, ask a question, speak up, make a call.', 'Do it today, however small.', 'Afterward, write what happened and how it felt.', 'Photograph your written reflection — not other people.'],
          why: 'Confidence is built by doing the thing, then reflecting — not by waiting.', helps: 'Each rep widens your comfort zone a little.',
          proof_prompt: 'Write and photograph a short reflection on your rep.',
          proof_must_show: 'Your written reflection: what you did and how it felt.',
          proof_reject_if: 'It is a photo of another person or anything private.',
          good_proof_examples: ['A 3-line reflection on a conversation you started', 'A checklist item ticked with a note'] },
        friction: { key: 'prepare-line', title: 'Prepare One Line', difficulty: 'easy', minutes: '5–10 min',
          steps: ['Pick a situation you find hard.', 'Write one opening line or question to use.', 'Say it out loud twice.', 'Photograph the written line.'],
          why: 'A prepared line removes the blank-mind moment that fuels anxiety.', helps: 'Makes the real rep far easier to start.',
          proof_prompt: 'Show your prepared line.',
          proof_must_show: 'A written opening line/question for a real situation.',
          proof_reject_if: 'It is blank or generic.',
          good_proof_examples: ['"Hey, mind if I join?" written and rehearsed'] },
        proof: { key: 'reflect-grow', title: 'Reflection Proof', difficulty: 'easy', minutes: '5–10 min',
          steps: ['Note one win and one thing to try next.', 'Keep it kind and honest.', 'Photograph the reflection.'],
          why: 'Reflection turns nerves into noticed progress.', helps: 'Builds self-belief from real evidence you’re changing.',
          proof_prompt: 'Show your written reflection.',
          proof_must_show: 'A short, honest note: one win + one next step.',
          proof_reject_if: 'It is shaming or blank.',
          good_proof_examples: ['"Win: spoke up in class. Next: ask one question."'] }
      }
    },

    wellbeing: {
      label: 'Wellbeing', parentPath: 'discipline', identity: 'The Reset',
      mission: 'Protect sleep, energy and calm with small daily routines.',
      dailyRule: 'Protect the routine first — the first 30 minutes before sleep, or one calm reset.',
      habits: ['sleep routine', 'wind-down', 'movement', 'reflection'],
      proofStandard: 'Proof can show a routine setup, an alarm, a journal, a screen-time setting, or a wind-down checklist. Nothing private or medical.',
      sensitive: true,
      whyStuck: 'Wellbeing slips when there’s no routine — VISION rebuilds one provable habit at a time.',
      milestones: ['First routine streak', 'A steadier sleep/energy pattern', 'A reliable daily reset'],
      tasks: {
        core: { key: 'wind-down', title: 'Protect Wind-Down', difficulty: 'core', minutes: '20–30 min',
          steps: ['Pick a consistent wind-down: screens off, lights low, read or stretch.', 'Set a phone cut-off and an alarm.', 'Do the routine tonight.', 'Photograph the setup (alarm, book, screen setting).'],
          why: 'The first 30 minutes before sleep set the whole night.', helps: 'Improves sleep, which improves everything else.',
          proof_prompt: 'Show your wind-down setup.',
          proof_must_show: 'A routine setup: alarm set, screen cut-off, book/stretch ready.',
          proof_reject_if: 'It is private or shows nothing about the routine.',
          good_proof_examples: ['Alarm + phone on Do Not Disturb', 'A book by the bed, lights low'] },
        friction: { key: 'screen-limit', title: 'Set A Screen Limit', difficulty: 'easy', minutes: '5 min',
          steps: ['Open settings.', 'Set a wind-down or app limit for the evening.', 'Photograph the setting.'],
          why: 'Late screens are the most common sleep-wrecker — remove the trigger.', helps: 'Protects the routine automatically each night.',
          proof_prompt: 'Show your screen-limit setting.',
          proof_must_show: 'A wind-down/app-limit setting enabled.',
          proof_reject_if: 'No setting was actually changed.',
          good_proof_examples: ['A bedtime/app-limit screen enabled'] },
        proof: { key: 'reflect-day', title: 'One-Line Journal', difficulty: 'easy', minutes: '5 min',
          steps: ['Write one line about today and one for tomorrow.', 'Keep it simple and kind.', 'Photograph the journal line.'],
          why: 'A tiny daily journal lowers stress and closes the day.', helps: 'Builds the calm, reflective habit that steadies energy.',
          proof_prompt: 'Show your one-line journal.',
          proof_must_show: 'A short written line for today/tomorrow.',
          proof_reject_if: 'It is blank.',
          good_proof_examples: ['"Today: walked + slept early. Tomorrow: same."'] }
      },
      note: 'General wellbeing habits only — not medical advice. For health concerns, speak to a professional.'
    },

    lifestyle: {
      label: 'Lifestyle', parentPath: 'discipline', identity: 'The Architect',
      mission: 'Build a more organised, intentional daily life, one provable habit at a time.',
      dailyRule: 'Order one part of your day, then prove it.',
      habits: ['organising', 'routines', 'planning', 'follow-through'],
      proofStandard: 'Proof must show a real change: an organised space, a built routine, or a completed plan.',
      whyStuck: 'Big life changes stall because they’re vague — VISION turns them into one organised, provable step.',
      milestones: ['First organised streak', 'A built daily routine', 'A calmer, ordered week'],
      tasks: {
        core: { key: 'organise-area', title: 'Organise One Area', difficulty: 'core', minutes: '20–40 min',
          steps: ['Pick one area: a room, a calendar, files, finances, a routine.', 'Order it properly today.', 'Photograph the organised result.'],
          why: 'Order in one area spreads to the rest of your life.', helps: 'Builds the organised baseline the goal needs.',
          proof_prompt: 'Show the area you organised.',
          proof_must_show: 'A genuinely organised space, calendar, or system.',
          proof_reject_if: 'Nothing actually changed.',
          good_proof_examples: ['A before/after of a tidied space', 'A planned-out calendar week'] },
        friction: { key: 'reset', title: 'Two-Minute Reset', difficulty: 'easy', minutes: '5–10 min',
          steps: ['Reset one small recurring mess (bag, desk, kitchen counter).', 'Make it the default state.', 'Photograph the reset.'],
          why: 'Small daily resets stop chaos rebuilding.', helps: 'Keeps the organised life from sliding back.',
          proof_prompt: 'Show your reset.',
          proof_must_show: 'A small area reset to its clean default.',
          proof_reject_if: 'Nothing changed.',
          good_proof_examples: ['A cleared counter', 'A packed bag ready for tomorrow'] },
        proof: { key: 'plan-day', title: 'Plan The Day', difficulty: 'easy', minutes: '5–10 min',
          steps: ['Write tomorrow’s plan and top 3.', 'Add one habit you’re keeping.', 'Photograph the plan.'],
          why: 'A planned day is an organised day.', helps: 'Turns intention into a followed routine.',
          proof_prompt: 'Show your written day plan.',
          proof_must_show: 'A plan with top-3 + one habit.',
          proof_reject_if: 'It is vague.',
          good_proof_examples: ['A planner page filled for tomorrow'] }
      }
    },

    custom: {
      label: 'Custom Goal', parentPath: 'discipline', identity: 'The Challenger',
      mission: 'Turn your goal into one provable action every day until it’s real.',
      dailyRule: 'Take one visible step toward the goal and prove it.',
      habits: ['daily action', 'removing friction', 'proof', 'review'],
      proofStandard: 'Proof must show a real step toward your goal — work done, an action taken, or a setup made. Keep it safe and non-private.',
      whyStuck: 'Any goal stalls without a daily move — VISION makes one provable step the whole job.',
      milestones: ['First action streak', 'First real milestone reached', 'A repeatable daily routine'],
      tasks: {
        core: { key: 'goal-action', title: 'One Real Step', difficulty: 'core', minutes: '20–40 min',
          steps: ['Pick the single most useful step toward your goal today.', 'Do it, however small.', 'Make a result you can show.', 'Photograph or screenshot the proof.'],
          why: 'Goals move on real steps, not intentions.', helps: 'Builds momentum and visible progress.',
          proof_prompt: 'Show the step you took.',
          proof_must_show: 'A real action or output toward your goal.',
          proof_reject_if: 'It is only planning with nothing done.',
          good_proof_examples: ['Work produced toward the goal', 'An action taken and captured'] },
        friction: { key: 'remove-block', title: 'Remove One Block', difficulty: 'easy', minutes: '5–15 min',
          steps: ['Name what stops you starting.', 'Remove or reduce it today.', 'Photograph the change.'],
          why: 'Most stalls are friction, not laziness.', helps: 'Makes tomorrow’s step easier to start.',
          proof_prompt: 'Show the block you removed.',
          proof_must_show: 'A real change that lowers friction.',
          proof_reject_if: 'Nothing changed.',
          good_proof_examples: ['A distraction removed', 'A setup prepared'] },
        proof: { key: 'review-note', title: 'Progress Note', difficulty: 'easy', minutes: '5–10 min',
          steps: ['Note what you did and tomorrow’s one next step.', 'Photograph the note.'],
          why: 'Reviewing keeps the goal pointed forward.', helps: 'Turns daily steps into directed progress.',
          proof_prompt: 'Show your progress note.',
          proof_must_show: 'A written note: today’s step + next step.',
          proof_reject_if: 'It is blank.',
          good_proof_examples: ['"Did X today; tomorrow: Y" written out'] }
      }
    }
  };

  /* ═══════════ CLASSIFICATION ═══════════
     Ordered matchers: first hit wins. Specific before general. */
  var MATCHERS = [
    /* ORDER IS THE CLASSIFICATION. classify() is first-match-wins, so a matcher
       listed earlier beats every one below it regardless of how much better the
       later one fits.
       `business` was FOURTH, behind sport/fitness/content, and the asymmetry
       that creates is severe: founder goals routinely contain sport/fitness
       words ("I own a gym business", "my startup is a fitness app", "I run a
       cafe"), while fitness goals almost never contain founder words. So the
       weaker signal was consistently winning. Measured on real phrasings, SEVEN
       of ten founder goals were misclassified -- and confidently, because
       analyzeGoal's `confidence` scores "a keyword fired", not "this is right":
       both of these came back at 1.0.

         "I run a commercial cleaning business in Dubbo"  -> fitness  (via "run a")
         "...and eventually launch it on Steam"           -> sport    (via "team" in S-team)

       Every misrouted founder loses the Founder engine entirely: no venture is
       created, so generate-tasks returns goal_required and the dashboard shows
       a dead error. Moving `business` first extends the rule this file already
       applies against `money` two matchers down, for the same reason.
       `scripts/qa-goal-classification-matrix.mjs` locks both collisions and the
       whole 15-domain matrix against reordering regressions. */
    /* Running or opening a venue is founder work however it is phrased: "my
       cafe" was already caught, but the far commoner "I run a cafe" was not,
       and fell through to fitness via the old bare `run a`. `prototype` is
       generic product-building vocabulary, not tied to any one industry. */
    /* A single keyword cannot recognise "Build and launch a premium PC
       roguelike deckbuilder" as founder work, and adding one that could would
       also swallow "launch my fitness journey". So the last alternative above
       is a CONJUNCTION, expressed as two lookaheads: the goal must describe
       MAKING something (build/create/ship/launch/publish) AND carry commercial
       intent (premium/paid/price/sell/customers/revenue/steam/first sales).
       Either signal alone is worthless -- "build muscle" makes something,
       "sell my old car" is commercial -- but together they are what separates a
       founder from every other goal, whatever the product happens to be.
       This exists because keyword-by-keyword patching is how `team` came to
       match "Steam": each patch buys one sentence and costs precision nobody
       measures until an account breaks. */
    ['business',         /business|startup|agency|company|client|freelanc|saas|ecommerce|e-commerce|\b(my|a|an|the|our|online)\s+stores?\b|\bbrand(ing)?\b(?!\s+new)|entrepreneur|side hustle|dropship|co[- ]?founder|founder|revenue|customers?|my (shop|store|cafe|café|restaurant|bakery|salon|studio|gym business)|coffee shop|i own\b|owner of|sell (online|products)|launch (a|my)?\s*(business|agency|startup|product|app)|\b(run|runs|running|own|owns|opening|opened|started)\s+(a|my|the)\s+(shop|store|cafe|café|restaurant|bakery|salon|studio|gym|bar|clinic|agency|practice)\b|\bprototype\b|(?=[\s\S]*\b(?:build|building|built|make|making|create|creating|develop|developing|ship|shipping|launch|launching|release|releasing|publish|publishing)\b)(?=[\s\S]*\b(?:premium|paid|paying|pricing|price|\$\d|sell|selling|customers?|subscribers?|revenue|monetis|monetiz|steam|app ?store|marketplace|first sales?)\b)/],
    /* Unbounded tokens below were matching inside unrelated words. `team` hit
       "Steam", `match` hits "matching", `sprint` hits "sprints" in an agile
       sense -- all now bounded. */
    ['sport',            /soccer|football|basketball|tennis|rugby|cricket|athlete|boxing|mma|\bsprint\b|striker|goalkeeper|sport|\bmatch\b|league|\bteam\b|swimming|martial|skater|skating|dribbl/],
    // "5k"/"10k" must stay bound to running context. Bare \d+k also appears in money
    // and audience goals ("$10k monthly revenue", "10k subscribers"), which were being
    // classified as fitness.
    /* `fit` matched "profit", "outfit" and "benefit"; `abs` matched
       "absolutely"; and bare `run a` matched "I run a business" far more often
       than "run a marathon", which the `marathon` token already covers. Bare
       `running` is safe now only because `business` is matched first, so
       "running a business" never reaches here. */
    ['fitness',          /gym|workout|\bfit(ness|ter)?\b|muscle|physique|\babs\b|lose weight|weight loss|lose fat|gain.*muscle|strength|bench|squat|run a\s+(marathon|race|half|5k|10k)|marathon|\brunning\b|\b(5|10)k\s*(run|race|park ?run)\b|run\s*(a\s*)?(5|10)k\b|press[- ]?up|push[- ]?up|train(ing)?\b|shred|bulk|toned?/],
    ['content',          /youtube|tiktok|instagram|channel|podcast|content|videos?|streamer|twitch|influencer|followers|subscribers|vlog|reels?/],
    ['money',            /\bsave|saving|\$\d|\d+\s*(dollars|k\b|bucks)|money|budget|debt|income|\bearn|salary|wealth|\brich|\binvest|financ|no[- ]?spend|frugal/],
    ['education',        /exam|test\b|grade|gpa|atar|study|studies|school|college|university|degree|revision|homework|biology|chemistry|physics|maths?|science|coursework|semester|pass (my|the)|\bread(ing)?\b/],
    ['career',           /lawyer|doctor|nurse|engineer|pilot|teacher|accountant|developer career|get a job|land a job|career|promotion|apprentice|interview|resume|cv\b|\blead(er|ership)\b|\bmanager\b|become (a|an)\s*(\w+\s+)?(lawyer|doctor|nurse|engineer|pilot|manager|leader|developer|designer|analyst)/],
    ['social-confidence',/confidence|confident|shy|social anxiety|public speaking|speak up|charisma|small talk|make friends|socialise|socialize|self[- ]?esteem|assertive|speaking/],
    ['wellbeing',        /sleep|insomnia|tired|burnout|stress|anxiety|calm|mental health|meditat|mindful|wellbeing|well-being|energy|wake up early|rest|relax/],
    ['skill-learning',   /learn|guitar|piano|coding|code|program|language|spanish|french|draw|drawing|paint|chess|cook|cooking|skill|how to|master (the|a)/],
    /* `art` matched inside "st-art", so "I want to start running three times a
       week" was classified as a creative goal. Bounded. */
    ['creativity',       /write a book|writing|novel|\bart\b|music|produce|beats|design|creative|illustrat|photograph|film|animation|craft/],
    ['productivity',     /productiv|stop wasting time|waste time|procrastinat|focus|time management|distract|efficient|get more done|stop scrolling/],
    ['discipline',       /disciplin|consistent|consistency|self[- ]?control|willpower|habit|routine|stop (being lazy|procrastinating)|commit|stick to/],
    ['lifestyle',        /organis|organiz|declutter|tidy|clean|life together|sort (out|my) life|relationship|family|parent|minimalis|intentional|better person/]
  ];

  // specific path-identity overrides for notable goals (richer than the domain default)
  var SUB_IDENTITY = [
    [/lawyer|law school|barrister|solicitor/, 'The Advocate'],
    [/doctor|medicine|medical|surgeon/, 'The Physician'],
    [/pilot/, 'The Aviator'],
    [/soccer|football|striker|midfield/, 'The Athlete'],
    [/guitar|piano|violin|drums|sing|music/, 'The Musician'],
    [/cod(e|ing)|program|developer|software|website|app\b/, 'The Engineer'],
    [/youtube|video|channel|streamer|vlog/, 'The Creator'],
    [/sleep|insomnia|rest/, 'The Reset'],
    [/confidence|confident|public speaking|speak/, 'The Speaker'],
    [/business|agency|startup|client|founder|revenue|i own\b|owner of/, 'The Builder'],
    [/write|novel|book|author/, 'The Writer'],
    [/lead(er|ership)|manager/, 'The Leader']
  ];

  function classify(goalText) {
    var t = clean(goalText);
    for (var i = 0; i < MATCHERS.length; i++) { if (MATCHERS[i][1].test(t)) return MATCHERS[i][0]; }
    return 'custom';
  }
  function subIdentity(goalText, fallback) {
    var t = clean(goalText);
    for (var i = 0; i < SUB_IDENTITY.length; i++) { if (SUB_IDENTITY[i][0].test(t)) return SUB_IDENTITY[i][1]; }
    return fallback;
  }

  /* ═══════════ ONBOARDING SIGNAL EXTRACTION ═══════════ */
  var BLOCKER_LABELS = ['procrastination', 'no clear plan', 'low energy', 'fear of failing', 'a tough environment', 'something else'];
  function blockersFrom(ob) {
    ob = ob || {};
    var out = [];
    var dis = ob.distraction || ob.distractionOther || '';
    if (typeof ob.block === 'string' && ob.block) out.push(clean(ob.block));
    if (dis) out.push(clean(dis));
    if (typeof ob.distractionIdx === 'number' && BLOCKER_LABELS[ob.distractionIdx]) out.push(BLOCKER_LABELS[ob.distractionIdx]);
    if (ob.goal_blocker) out.push(clean(ob.goal_blocker));
    if (!out.length) out.push('inconsistency');
    return out.filter(function (v, i, a) { return v && a.indexOf(v) === i; }).slice(0, 3);
  }
  var HORIZON = { 0: '30 days', 1: '90 days', 2: '6 months', 3: '1 year', 4: 'long-term', 5: 'a fixed date' };
  function horizonFrom(ob) {
    ob = ob || {};
    if (ob.timeline && /\w/.test(ob.timeline)) return ob.timeline === 'Fixed date' ? 'a fixed date' : ob.timeline;
    if (typeof ob.timelineIdx === 'number') return HORIZON[ob.timelineIdx] || 'flexible';
    if (typeof ob.intensityIdx === 'number') return ['steady', '90-day sprint', 'all-in', 'extreme'][ob.intensityIdx] || 'flexible';
    return 'flexible';
  }
  function measurableFrom(goalText) {
    var m = clean(goalText).match(/\$?\s?\d[\d,\.]*\s?(k|dollars|kg|lbs|%|followers|subscribers|words|reps|days|hours|months)?/);
    return m ? m[0].trim() : null;
  }

  /* ═══════════ 1. analyzeGoal ═══════════ */
  function analyzeGoal(input, onboarding) {
    var raw = String(input || '').trim();
    var ob = onboarding || {};
    var domainKey = classify(raw || ob.goalDetail || '');
    var D = DOMAINS[domainKey];
    var identity = subIdentity(raw, D.identity);
    var measurable = measurableFrom(raw);
    // deterministic confidence (0–1): how sure the engine is it understood the goal.
    // Higher when a real domain matched, a specific sub-identity hit, and a
    // measurable target was found; lowest for an unclassified custom goal.
    var conf = 0.5;
    if (domainKey !== 'custom') conf += 0.25;
    if (identity !== D.identity) conf += 0.15;   // a specific sub-identity override matched
    if (measurable) conf += 0.10;
    conf = Math.round(Math.min(1, Math.max(0, conf)) * 100) / 100;
    return {
      rawGoal: raw || 'Self improvement',
      normalizedGoal: cap(clean(raw).replace(/^i (want to|wanna|need to|would like to)\s*/, '')) || 'Self improvement',
      domain: domainKey,
      domainLabel: D.label,
      parentPath: D.parentPath,
      subDomain: identity,
      pathIdentity: identity,
      skillType: D.habits[0],
      timeHorizon: horizonFrom(ob),
      difficulty: (ob.intensityIdx >= 2 ? 'high' : ob.intensityIdx === 0 ? 'gentle' : 'moderate'),
      measurableOutcome: measurable,
      proofType: D.proofStandard,
      riskLevel: D.sensitive ? 'sensitive' : 'standard',
      confidence: conf,
      blockers: blockersFrom(ob),
      requiredHabits: D.habits.slice(),
      milestoneStyle: D.milestones.slice(),
      safetyNote: D.note || null
    };
  }

  /* ═══════════ 2. createGoalBlueprint ═══════════ */
  function createGoalBlueprint(analysis, onboarding) {
    var a = analysis || analyzeGoal('', onboarding);
    var D = DOMAINS[a.domain] || DOMAINS.custom;
    var goal = a.normalizedGoal;
    var blockerLine = a.blockers && a.blockers.length ? a.blockers[0] : 'inconsistency';
    return {
      title: (a.domainLabel) + ' Path',
      goal: goal,
      domain: a.domain,
      pathIdentity: a.pathIdentity,
      oneSentenceMission: D.mission,
      whyYouAreStuck: D.whyStuck + ' Right now your main blocker is ' + blockerLine + '.',
      dailyOperatingRule: D.dailyRule,
      proofStandard: D.proofStandard,
      firstMilestone: a.milestoneStyle[0],
      sevenDayTarget: a.milestoneStyle[0] + ' — 7 days of proof.',
      thirtyDayTarget: a.milestoneStyle[2] || a.milestoneStyle[a.milestoneStyle.length - 1],
      requiredHabits: a.requiredHabits,
      todayFocus: D.dailyRule,
      tomorrowUnlock: 'Tomorrow’s plan unlocks after today’s proof.',
      milestones: a.milestoneStyle.map(function (m, i) { return { label: m, stage: ['first', 'mid', 'lock-in'][i] || 'stage' }; }),
      safetyNote: a.safetyNote
    };
  }

  /* ═══════════ 3. generateGuidedAssignments ═══════════
     userState: { dayIndex, blockers, completedToday, missedYesterday, proofStreakOnTask }
     Returns 3 role tasks (core / friction / proof) fully coached.
     Variation: friction task can swap for a comeback task after a miss. */
  function buildTask(domainKey, role, t, userState) {
    var difficulty = t.difficulty || (role === 'core' ? 'core' : role === 'proof' ? 'core' : 'easy');
    return {
      key: t.key,
      role: role,                                    // core | friction | proof
      title: t.title,
      meta: t.minutes,
      estimated_minutes: t.minutes,
      difficulty: difficulty,
      xp: XP_BY_DIFF[difficulty] || 40,
      steps: t.steps.slice(),
      why: t.why,
      helps: t.helps,
      proof_prompt: t.proof_prompt,
      proof_must_show: t.proof_must_show,
      proof_reject_if: t.proof_reject_if,
      good_proof_examples: t.good_proof_examples.slice(),
      proof: true                                    // photo/evidence proof always required
    };
  }
  /* Comeback plan: the softened, low-friction restart task shown after a missed
     day. Non-shaming by design. Returned standalone so callers/tests can request
     just the comeback move; generateGuidedAssignments uses it on missedYesterday. */
  function generateComebackPlan(blueprint, userState) {
    var D = DOMAINS[(blueprint && blueprint.domain) || 'custom'] || DOMAINS.custom;
    var friction = buildTask((blueprint && blueprint.domain) || 'custom', 'friction', D.tasks.friction, userState || {});
    friction.title = 'Comeback: ' + friction.title;
    friction.why = 'You missed yesterday — no shame. This is the smallest rep to restart momentum. ' + friction.why;
    friction.comeback = true;
    return friction;
  }
  function generateGuidedAssignments(blueprint, userState) {
    var D = DOMAINS[(blueprint && blueprint.domain) || 'custom'] || DOMAINS.custom;
    var st = userState || {};
    var core = buildTask(D === DOMAINS.custom ? 'custom' : blueprint.domain, 'core', D.tasks.core, st);
    var friction = buildTask(blueprint.domain, 'friction', D.tasks.friction, st);
    var proof = buildTask(blueprint.domain, 'proof', D.tasks.proof, st);

    // adaptation: after a miss, swap the friction task for a softened comeback rep
    if (st.missedYesterday) {
      friction = generateComebackPlan(blueprint, st);
    }
    // adaptation: many repeats on this goal → nudge variation in the core "why"
    if ((st.proofStreakOnTask || 0) >= 5) {
      core.why = 'You’ve proven this consistently — push the quality up a level today. ' + core.why;
    }
    return [core, friction, proof];
  }

  /* ═══════════ 4. getProofRequirements ═══════════ */
  function getProofRequirements(task, blueprint) {
    if (!task) return null;
    return {
      prompt: task.proof_prompt,
      mustShow: task.proof_must_show,
      rejectIf: task.proof_reject_if,
      goodExamples: task.good_proof_examples || [],
      standard: (blueprint && blueprint.proofStandard) || '',
      safe: 'No photos of other people. Nothing private or unsafe. Evidence of your own work only.'
    };
  }

  /* Goal forecast: what today's choice does to the plan. Standalone (spec API)
     so callers/tests can request the forecast directly; generateDailyStrategy
     calls it with the resolved task count. */
  function calculateGoalForecast(blueprint, userState) {
    var st = userState || {};
    var totalToday = (typeof st.totalToday === 'number') ? st.totalToday : 3;
    var doneToday = st.completedToday || 0;
    var remaining = Math.max(0, totalToday - doneToday);
    return {
      ifCompleteToday: remaining > 0
        ? 'Prove today’s ' + remaining + ' task' + (remaining > 1 ? 's' : '') + ' → tomorrow’s plan unlocks and your pace moves forward.'
        : 'Fully proven — tomorrow’s strategy is unlocked.',
      ifMissToday: 'Miss today and the plan holds, not shames — tomorrow starts with a smaller comeback rep.',
      afterProof: 'Each photo proof advances your blueprint and raises your Future Score; XP is only awarded with real proof.'
    };
  }

  /* ═══════════ 5. generateDailyStrategy ═══════════
     Assembles the Strategist-page payload: hero + diagnosis + today's move
     + guided assignments + forecast. Non-shaming copy throughout. */
  function generateDailyStrategy(blueprint, userState) {
    var st = userState || {};
    var a = st.analysis || {};
    var D = DOMAINS[blueprint.domain] || DOMAINS.custom;
    var assignments = generateGuidedAssignments(blueprint, st);
    var doneToday = st.completedToday || 0;
    var totalToday = assignments.length;
    var remaining = Math.max(0, totalToday - doneToday);
    var blockers = (a.blockers && a.blockers.length) ? a.blockers : (st.blockers || ['inconsistency']);

    var diagnosis = [];
    diagnosis.push('Your main blocker is ' + blockers[0] + ', so today leads with one low-friction proof.');
    if (st.screenHigh) diagnosis.push('High screen time is narrowing your focus window — today protects it.');
    diagnosis.push(D.whyStuck);
    if (doneToday > 0) diagnosis.push(doneToday + ' of ' + totalToday + ' proven today — momentum is live.');
    else if ((st.provenDays || 0) === 0) diagnosis.push('Consistency is still forming — your first photo proofs matter most.');
    else diagnosis.push('You’ve proven before — today is about restarting the streak.');

    var todayMove = {
      headline: D.dailyRule,
      training: 'Today is training: ' + (D.habits[0]) + ' + ' + (D.habits[1] || 'consistency') + '.',
      whyItMatters: 'It directly attacks your blocker (' + blockers[0] + ') and moves "' + blueprint.goal + '" forward.',
      avoid: 'Avoid consuming content about the goal instead of proving one real rep.'
    };

    var forecast = calculateGoalForecast(blueprint, Object.assign({}, st, { totalToday: totalToday, completedToday: doneToday }));

    return {
      blueprint: blueprint,
      pathIdentity: blueprint.pathIdentity,
      diagnosis: diagnosis.slice(0, 5),
      todayMove: todayMove,
      guidedAssignments: assignments,
      forecast: forecast,
      lockedTomorrow: remaining > 0 ? 'Tomorrow unlocks after today’s proof.' : null,
      proofStandard: blueprint.proofStandard
    };
  }

  /* ═══════════ 6. updateStrategyAfterProof ═══════════
     Pure advisory recompute the callers can use for adaptive copy. The real
     XP/score writes stay in submit_proof (backend) / logProof (demo). */
  function updateStrategyAfterProof(userState) {
    var st = userState || {};
    var done = (st.completedToday || 0);
    var total = (st.totalToday || 3);
    var allDone = done >= total && total > 0;
    return {
      unlockedTomorrow: allDone,
      difficultyNudge: allDone ? 'up' : 'hold',
      message: allDone
        ? 'Assignment complete — tomorrow’s plan is unlocked and steps up slightly.'
        : 'Proof logged. ' + Math.max(0, total - done) + ' left to unlock tomorrow.',
      confidenceCopy: allDone ? 'You did the whole day. This is how the future changes.' : 'One proof in — keep the momentum.'
    };
  }

  /* ═══════════════════════════════════════════════════════════════
     PERSONALISATION LAYER — same goal, different user ⇒ different plan.
     Fully deterministic. A future server-side AI planner could replace
     buildPersonalisationProfile + generatePersonalisedDailyPlan wholesale
     without touching any caller (see generateStrategy's AI branch). It
     never calls AI, never holds a key, and never asks for unsafe/private
     proof (sensitive domains keep their safe, reflection-based proof).
  ═══════════════════════════════════════════════════════════════ */
  var DIFF_ORDER = ['easy', 'core', 'hard'];
  // free-text blocker → normalized tag the plan reacts to (first hit wins)
  var BLOCKER_TAGS = [
    ['phone',         /phone|screen|scroll|social media|tiktok|instagram|youtube|distract/],
    ['confidence',    /confidence|confident|shy|scared|afraid|nervous|anxious|judged|embarrass/],
    ['unclear',       /don.?t know|do not know|unclear|where to start|next step|confus|overwhelm|no plan/],
    ['energy',        /energy|tired|exhaust|\blazy\b|motivat|burnt|burnout/],
    ['time',          /\btime\b|too busy|no time|\bbusy\b|schedule/],
    ['fear',          /\bfear\b|fail|failure|avoid|perfection/],
    ['resources',     /equipment|gym access|tools|resources|can.?t afford|no access/],
    ['inconsistency', /consisten|disciplin|give up|quit|stick to|routine|habit/]
  ];
  var BLOCKER_LABEL = {
    phone: 'phone distraction', confidence: 'low confidence', unclear: 'not knowing the next step',
    energy: 'low energy', time: 'limited time', fear: 'fear of failing',
    resources: 'limited resources', inconsistency: 'inconsistency'
  };
  function blockerTag(text) {
    var t = clean(text);
    for (var i = 0; i < BLOCKER_TAGS.length; i++) { if (BLOCKER_TAGS[i][1].test(t)) return BLOCKER_TAGS[i][0]; }
    return 'inconsistency';
  }
  function minutesFromTime(s) {
    var t = clean(s); var m = t.match(/(\d+)/);
    if (/hour|\bhr/.test(t)) { var h = m ? parseInt(m[1], 10) : 1; return Math.min(180, h * 60); }
    if (m) return Math.max(5, Math.min(180, parseInt(m[1], 10)));
    return 30;
  }
  function timeLabel(min) {
    if (min <= 20) return '10–20 min';
    if (min <= 35) return '25–35 min';
    if (min <= 50) return '40–50 min';
    return '45–60 min';
  }

  /* 1. buildPersonalisationProfile — the single normalized view of THIS user.
     Accepts any of { onboarding, profile, scores, proofs, tasks, history, analysis,
     currentDate }; tolerates partial input (demo passes onboarding+history). */
  function buildPersonalisationProfile(input) {
    input = input || {};
    var ob = input.onboarding || {};
    var hist = input.history || {};
    var scores = input.scores || {};
    var proofs = input.proofs || null;
    var a = ob.goalAnalysis || input.analysis;
    if (!a) { try { a = analyzeGoal(ob.goalText || ob.primaryGoal || ob.goalDetail || '', ob); } catch (e) { a = {}; } }

    // ── blocker ──
    var blockerRaw = ob.goal_blocker || ob.goalBlocker || ob.blockText || ob.block ||
                     ob.distraction || ob.distractionOther || ob.obstacle ||
                     (a.blockers && a.blockers[0]) || 'inconsistency';
    var primaryTag = blockerTag(blockerRaw);

    // ── capacity ──
    var minutes = (typeof hist.minutes === 'number') ? hist.minutes
                : minutesFromTime(ob.availableTime || ob.available_time || '');
    var intensityIdx = (typeof ob.intensityIdx === 'number') ? ob.intensityIdx : 1;
    var difficultyPref = intensityIdx >= 2 ? 'hard' : intensityIdx === 0 ? 'gentle' : 'moderate';
    var sleepIdx = (typeof ob.sleepIdx === 'number') ? ob.sleepIdx : (typeof ob.sleep === 'number' ? ob.sleep : null);
    var sleepLevel = (sleepIdx == null) ? 'unknown' : (sleepIdx >= 3 ? 'poor' : sleepIdx <= 1 ? 'good' : 'ok');
    var screenIdx = (typeof ob.screenIdx === 'number') ? ob.screenIdx : (typeof ob.screen_time === 'number' ? ob.screen_time : null);
    var screenHigh = (screenIdx != null && screenIdx >= 3) || !!hist.screenHigh || primaryTag === 'phone';

    // ── behaviour ──
    var completedToday = (hist.completedToday != null) ? hist.completedToday
      : (proofs ? proofs.filter(function (p) { return p.date === todayStr(); }).length : 0);
    var streak = (hist.streak != null) ? hist.streak : (scores.streak || 0);
    var provenDays = (hist.provenDays != null) ? hist.provenDays : 0;
    var missedYesterday = !!hist.missedYesterday;
    var completionRate = (hist.completionRate != null) ? hist.completionRate
      : (provenDays > 0 ? Math.min(1, provenDays / (provenDays + (missedYesterday ? 1 : 0))) : 0);

    // ── style ──
    var proofPreference = ob.proofPreference || ob.proof_preference ||
      (a.domain === 'social-confidence' || a.domain === 'wellbeing' ? 'written note' : 'photo of work');
    var planStyle = minutes <= 20 ? 'quick-win' : (minutes >= 50 && difficultyPref !== 'gentle') ? 'deep-work' : 'balanced';
    var tone = missedYesterday ? 'gentle' : (streak >= 5 || difficultyPref === 'hard') ? 'challenge' : 'standard';

    var D = DOMAINS[a.domain] || DOMAINS.custom;
    return {
      goal: { raw: a.rawGoal, normalized: a.normalizedGoal, domain: a.domain, domainLabel: a.domainLabel,
              pathIdentity: a.pathIdentity, reason: ob.goalReason || ob.goal_reason || '', timeHorizon: a.timeHorizon },
      blocker: { primary: primaryTag, raw: clean(blockerRaw), tags: [primaryTag] },
      capacity: { minutes: minutes, difficultyPref: difficultyPref, sleepLevel: sleepLevel, screenHigh: screenHigh },
      behaviour: { completedToday: completedToday, provenDays: provenDays, streak: streak,
                   missedYesterday: missedYesterday, completionRate: completionRate },
      style: { proofPreference: proofPreference, planStyle: planStyle, tone: tone },
      safety: { sensitive: !!D.sensitive, domain: a.domain }
    };
  }

  // capacity/behaviour → a -2..+2 difficulty bias
  function diffBias(p) {
    var b = 0, c = p.capacity, beh = p.behaviour;
    if (c.minutes <= 20) b -= 1;
    if (c.sleepLevel === 'poor') b -= 1;
    if (beh.missedYesterday) b -= 1;
    if (c.difficultyPref === 'gentle') b -= 1;
    if (c.minutes >= 50 && beh.streak >= 3) b += 1;
    if (c.difficultyPref === 'hard') b += 1;
    if (beh.streak >= 7) b += 1;
    return Math.max(-2, Math.min(2, b));
  }
  /* 2. selectTaskDifficulty — recommended difficulty for the core move today. */
  function selectTaskDifficulty(blueprint, profile) {
    return DIFF_ORDER[Math.max(0, Math.min(2, 1 + diffBias(profile)))];
  }
  /* 3. chooseTodayFocus — which role leads + a focus line in the user's terms. */
  function chooseTodayFocus(blueprint, profile) {
    var beh = profile.behaviour, bk = profile.blocker.primary;
    var leadFriction = beh.missedYesterday || bk === 'phone' || bk === 'unclear' || bk === 'energy';
    return {
      role: leadFriction ? 'friction' : 'core',
      line: leadFriction
        ? 'Today removes the blocker first — ' + (BLOCKER_LABEL[bk] || 'friction') + ' — then one real rep.'
        : 'Today moves “' + profile.goal.normalized + '” forward with one real rep.'
    };
  }

  // enrich one base task with this user's context (difficulty/time scaling + coaching)
  function personaliseTask(task, role, profile) {
    var c = profile.capacity, beh = profile.behaviour, bk = profile.blocker.primary;
    var idx = DIFF_ORDER.indexOf(task.difficulty); if (idx < 0) idx = 1;
    idx = Math.max(0, Math.min(2, idx + diffBias(profile)));
    if (role !== 'core' && idx > 1) idx = 1;        // never push friction/comeback/proof to 'hard'
    task.difficulty = DIFF_ORDER[idx];
    task.xp = XP_BY_DIFF[task.difficulty] || 40;     // advisory; backend re-clamps by difficulty
    task.estimated_minutes = timeLabel(c.minutes);
    task.meta = task.estimated_minutes;

    task.whyChosen = task.comeback
      ? 'Chosen because you missed yesterday — the smallest rep to restart, not a reset.'
      : role === 'core'
        ? 'Chosen because it moves “' + profile.goal.normalized + '” forward directly, sized to your ~' + c.minutes + ' min today.'
        : role === 'friction'
          ? 'Chosen because your blocker is ' + (BLOCKER_LABEL[bk] || bk) + ' — clearing it first makes the real work possible.'
          : 'Chosen to lock in today’s evidence so tomorrow’s strategy unlocks.';
    task.achievable_today = 'Sized for your ~' + c.minutes + ' min today — small enough to start, real enough to count.';
    task.mistake_to_avoid = task.proof_reject_if
      ? ('Don’t submit if ' + task.proof_reject_if.charAt(0).toLowerCase() + task.proof_reject_if.slice(1))
      : 'Don’t fake it — proof must show real work you did today.';

    // fallback (low time/energy) — strictly smaller, still counts
    task.fallback = {
      title: 'Lite: ' + task.title, difficulty: 'easy', xp: XP_BY_DIFF.easy, estimated_minutes: '5–10 min',
      steps: (task.steps || []).slice(0, 2), proof_prompt: task.proof_prompt,
      note: 'Low on time or energy? This smaller version still counts and keeps the streak alive.'
    };
    // upgrade (streak/high time) — harder, higher standard (same proof gateway, not extra XP path)
    task.upgrade = {
      title: 'Stretch: ' + task.title, difficulty: 'hard', xp: XP_BY_DIFF.hard, estimated_minutes: timeLabel(Math.max(c.minutes, 60)),
      steps: (task.steps || []).concat(['Push one level past yesterday and note what improved.']),
      proof_prompt: task.proof_prompt + ' Show the higher-effort version.',
      note: 'On a roll? Take the harder version for a stronger proof.'
    };
    task.personalisation_tags = [bk, c.difficultyPref, profile.style.planStyle]
      .concat(beh.missedYesterday ? ['comeback'] : (beh.streak >= 5 ? ['streak'] : []));
    return task;
  }

  /* 4. generatePersonalisedAssignments — 3 base role-tasks, then personalised. */
  function generatePersonalisedAssignments(blueprint, profile) {
    var analysis = { blockers: [profile.blocker.primary].concat(profile.blocker.tags) };
    var us = {
      analysis: analysis, blockers: analysis.blockers,
      completedToday: profile.behaviour.completedToday,
      missedYesterday: profile.behaviour.missedYesterday,
      proofStreakOnTask: profile.behaviour.streak,
      provenDays: profile.behaviour.provenDays,
      screenHigh: profile.capacity.screenHigh
    };
    var base = generateGuidedAssignments(blueprint, us);   // core, friction|comeback, proof
    return base.map(function (t) { return personaliseTask(t, t.role || 'core', profile); });
  }

  /* 5. explainWhyThisPlan — plain lines using the user's ACTUAL context. */
  function explainWhyThisPlan(blueprint, profile) {
    var c = profile.capacity, beh = profile.behaviour, out = [];
    out.push('Because you said your blocker is ' + (BLOCKER_LABEL[profile.blocker.primary] || profile.blocker.primary) + ', today leads with the move that clears it first.');
    out.push('You have about ' + c.minutes + ' minutes today, so each task is sized to actually finish — not to overwhelm.');
    if (c.sleepLevel === 'poor') out.push('Sleep has been low, so today stays recovery-friendly and avoids heavy load.');
    else if (c.screenHigh) out.push('High screen time narrows focus, so a phone-away block comes before the deep work.');
    if (beh.missedYesterday) out.push('You missed yesterday — that doesn’t reset the goal, it just makes today a smaller comeback.');
    else if (beh.streak >= 5) out.push('You’re on a ' + beh.streak + '-day streak, so today steps up slightly for a stronger proof.');
    else if (beh.streak >= 1) out.push('You’re ' + beh.streak + ' day' + (beh.streak === 1 ? '' : 's') + ' in — today keeps the momentum and builds the habit.');
    else out.push('Consistency is still forming — today’s proof is what makes tomorrow’s plan unlock.');
    return out.slice(0, 4);
  }

  /* 6. adaptPlanAfterMiss / adaptPlanAfterWin — the explicit comeback / upgrade moves. */
  function adaptPlanAfterMiss(blueprint, profile) {
    var p = Object.assign({}, profile, { behaviour: Object.assign({}, profile.behaviour, { missedYesterday: true }) });
    var lead = personaliseTask(generateComebackPlan(blueprint, { missedYesterday: true }), 'friction', p);
    return { tone: 'gentle', lead: lead, message: 'Missed yesterday does not reset the goal. It changes the next move.' };
  }
  function adaptPlanAfterWin(blueprint, profile) {
    var D = DOMAINS[blueprint.domain] || DOMAINS.custom;
    var p = Object.assign({}, profile, { behaviour: Object.assign({}, profile.behaviour, { streak: Math.max(5, profile.behaviour.streak) }) });
    var core = personaliseTask(buildTask(blueprint.domain, 'core', D.tasks.core, {}), 'core', p);
    return { tone: 'challenge', lead: core, upgrade: core.upgrade, message: 'You’re proving consistently — today’s standard goes up.' };
  }

  /* 7. getUserPatternSummary — short profile-page summary of how this user operates. */
  function getUserPatternSummary(profile) {
    var beh = profile.behaviour;
    var consistency = beh.completionRate >= 0.75 ? 'Strong' : beh.completionRate >= 0.4 ? 'Building' : beh.provenDays > 0 ? 'Early' : 'Just starting';
    var strongest = beh.streak >= 3 ? 'Showing up daily (' + beh.streak + '-day streak)' : beh.provenDays > 0 ? 'Logging real proof' : 'Getting started';
    var styleLabel = profile.style.planStyle === 'quick-win' ? 'Quick wins (short, frequent)'
      : profile.style.planStyle === 'deep-work' ? 'Deep work (longer, focused)' : 'Balanced';
    var blockerLabel = BLOCKER_LABEL[profile.blocker.primary] || profile.blocker.primary;
    return {
      strongestHabit: strongest, biggestBlocker: blockerLabel, planStyle: styleLabel, proofConsistency: consistency,
      line: profile.goal.pathIdentity + ' · ' + styleLabel + ' · blocker: ' + blockerLabel + ' · ' + consistency + ' consistency'
    };
  }

  /* 8. generatePersonalisedDailyPlan — the full Strategist payload (same shape as
     generateDailyStrategy + personalised extras). */
  function generatePersonalisedDailyPlan(blueprint, profile) {
    var assignments = generatePersonalisedAssignments(blueprint, profile);
    var focus = chooseTodayFocus(blueprint, profile);
    var why = explainWhyThisPlan(blueprint, profile);
    var doneToday = profile.behaviour.completedToday || 0;
    var totalToday = assignments.length;
    var remaining = Math.max(0, totalToday - doneToday);
    var forecast = calculateGoalForecast(blueprint, { totalToday: totalToday, completedToday: doneToday });
    var habits = (blueprint.requiredHabits && blueprint.requiredHabits.length) ? blueprint.requiredHabits : ['focus', 'consistency'];
    var todayMove = {
      headline: focus.line,
      training: 'Today is training: ' + habits.slice(0, 2).join(' + ') + '.',
      whyItMatters: 'It targets your blocker (' + (BLOCKER_LABEL[profile.blocker.primary] || profile.blocker.primary) + ') and moves “' + profile.goal.normalized + '” forward.',
      avoid: 'Avoid consuming content about the goal instead of proving one real rep.'
    };
    return {
      blueprint: blueprint, pathIdentity: blueprint.pathIdentity,
      diagnosis: why, whyPersonalised: why, todayFocus: focus, todayMove: todayMove,
      guidedAssignments: assignments, forecast: forecast,
      lockedTomorrow: remaining > 0 ? 'Tomorrow unlocks after today’s proof.' : null,
      proofStandard: blueprint.proofStandard,
      patternSummary: getUserPatternSummary(profile), tone: profile.style.tone, planStyle: profile.style.planStyle
    };
  }

  /* ═══════════ AI-READY WRAPPER ═══════════
     Single entry the app can call. Today: deterministic + personalised. Later: a
     server-side planner can fill the AI branch WITHOUT changing any caller. Never
     calls AI from the browser and never holds a key here. */
  function deterministicStrategy(goal, onboarding, history) {
    var analysis = analyzeGoal(goal, onboarding);
    var blueprint = createGoalBlueprint(analysis, onboarding);
    var profile = buildPersonalisationProfile({
      onboarding: Object.assign({}, onboarding || {}, { goalAnalysis: analysis }),
      history: history || {}, analysis: analysis
    });
    var daily = generatePersonalisedDailyPlan(blueprint, profile);
    return { analysis: analysis, blueprint: blueprint, profile: profile, daily: daily };
  }
  async function generateStrategy(opts) {
    opts = opts || {};
    if (AI_PROVIDER_ENABLED) {
      // FUTURE: call a server-side AI planner endpoint here (no key in browser).
      // const r = await fetch('/api/plan', {method:'POST', body: JSON.stringify(opts)}); return r.json();
    }
    return deterministicStrategy(opts.goal, opts.onboarding, opts.history);
  }

  /* ═══════════ TASK QUALITY LINTER ═══════════
     Tasks must not be vague. A task is only allowed into the daily plan if it
     names a concrete action, carries a real proof contract, and fits a sane
     time box. Today's deterministic templates always pass — this is the gate
     that keeps a future AI planner (or any new template) honest. Pure + cheap. */
  var VAGUE_TASK_RE = /\b(do better|try harder|push yourself|be (more )?(productive|consistent|disciplined|focused|better|great)|work on (it|yourself|stuff|things|everything)|think about (it|your goals?|life)|(get|stay) motivated|level up|lock in|no excuses|grind|hustle|just start|make progress|believe in yourself)\b/i;
  function lintMinutes(label) {
    var nums = String(label == null ? '' : label).match(/\d+/g);
    if (!nums || !nums.length) return false;                       // unparseable time box
    return nums.every(function (n) { n = parseInt(n, 10); return n >= 5 && n <= 120; });
  }
  function lintTask(t) {
    var reasons = [];
    var title = t && String(t.title || '').trim();
    if (!title || title.length < 4) reasons.push('missing_title');
    else if (VAGUE_TASK_RE.test(title) || title.split(/\s+/).length < 2) reasons.push('vague_title');
    if (!(t && t.proof_must_show)) reasons.push('missing_proof_must_show');
    if (!(t && t.proof_reject_if)) reasons.push('missing_proof_reject_if');
    if (!(t && t.steps && t.steps.length)) reasons.push('missing_steps');
    if (!lintMinutes(t && (t.est_minutes || t.estimated_minutes || t.meta))) reasons.push('bad_duration');
    return { ok: reasons.length === 0, reasons: reasons };
  }

  /* ═══════════ PUBLIC API ═══════════ */
  V.goal = {
    AI_PROVIDER_ENABLED: AI_PROVIDER_ENABLED,
    DOMAINS: DOMAINS,
    XP_BY_DIFF: XP_BY_DIFF,
    classify: classify,
    analyzeGoal: analyzeGoal,
    createGoalBlueprint: createGoalBlueprint,
    generateGuidedAssignments: generateGuidedAssignments,
    generateComebackPlan: generateComebackPlan,
    getProofRequirements: getProofRequirements,
    lintTask: lintTask,
    calculateGoalForecast: calculateGoalForecast,
    generateDailyStrategy: generateDailyStrategy,
    updateStrategyAfterProof: updateStrategyAfterProof,
    // ── personalisation layer ──
    buildPersonalisationProfile: buildPersonalisationProfile,
    selectTaskDifficulty: selectTaskDifficulty,
    chooseTodayFocus: chooseTodayFocus,
    generatePersonalisedAssignments: generatePersonalisedAssignments,
    generatePersonalisedDailyPlan: generatePersonalisedDailyPlan,
    explainWhyThisPlan: explainWhyThisPlan,
    adaptPlanAfterMiss: adaptPlanAfterMiss,
    adaptPlanAfterWin: adaptPlanAfterWin,
    getUserPatternSummary: getUserPatternSummary,
    generateStrategy: generateStrategy,
    deterministicStrategy: deterministicStrategy
  };

  // Node/test interop (no effect in the browser)
  if (typeof module !== 'undefined' && module.exports) { module.exports = V.goal; }
})(window.VISION);
