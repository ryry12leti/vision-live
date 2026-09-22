/* ═══════════════════════════════════════════════════════════════
   tasks-library.js — VISION Proof Prompt Template Library + Selector
   ---------------------------------------------------------------
   The single source of truth for what a "good directive" is.

   Every day a user gets exactly THREE directives:
     • CORE     (required)  — the main rep that moves the goal
     • MOMENTUM (optional)  — the 5–10 min minimum-viable win
     • EDGE     (optional)  — a skill-builder, shown only when there's
                              capacity (time ≥ 30 OR energy ≠ low)

   A directive is NEVER freeform. It is materialised from a vetted
   template into a strict Task Contract (see materialise()), then
   gated by lintTask() before it can render. Selection is rule-based
   and deterministic per (user, day): same inputs → same plan, but it
   rotates across days and never repeats a template within 7 days or
   the same proof requirement two days running.

   Pure vanilla JS, no build, no network. XP is NEVER awarded here —
   base_xp is advisory; the backend submit_proof RPC is the only writer
   of XP (no photo = no XP). Sensitive domains keep safe, non-private
   proof. Public API: window.VISION.tasks
═══════════════════════════════════════════════════════════════ */
window.VISION = window.VISION || {};

(function (V) {
  'use strict';

  /* ── enums shared with the contract ── */
  var SLOTS = ['core', 'momentum', 'edge'];
  var TIME_BUCKETS = [5, 15, 30, 60];
  var ENERGY = ['low', 'normal', 'high'];
  // difficulty_1_to_5 → legacy difficulty bucket the scoring/RPC layer uses
  var XP_BY_DIFF = { easy: 20, core: 40, hard: 60 };
  function diffBucket(n) { n = n | 0; return n <= 2 ? 'easy' : n >= 4 ? 'hard' : 'core'; }

  /* ── normalised blocker vocabulary (superset of the brief + engine tags) ── */
  // procrastination · no-plan · low-energy · fear · bad-environment · phone · confidence · time · inconsistency
  var BLOCKER_ALIAS = {
    phone: 'phone', scroll: 'phone', distract: 'phone', procrastinat: 'procrastination',
    procrastination: 'procrastination', procrastinate: 'procrastination', lazy: 'procrastination',
    'put off': 'procrastination', 'putting off': 'procrastination',
    unclear: 'no-plan', 'no-plan': 'no-plan', plan: 'no-plan', overwhelm: 'no-plan',
    energy: 'low-energy', 'low-energy': 'low-energy', tired: 'low-energy', burnout: 'low-energy',
    fear: 'fear', failure: 'fear', perfection: 'fear',
    confidence: 'confidence', shy: 'confidence', nervous: 'confidence',
    resources: 'bad-environment', 'bad-environment': 'bad-environment', environment: 'bad-environment',
    time: 'time', busy: 'time', inconsistency: 'inconsistency', consistency: 'inconsistency'
  };
  function normalizeBlocker(b) {
    b = String(b == null ? '' : b).toLowerCase().trim();
    if (BLOCKER_ALIAS[b]) return BLOCKER_ALIAS[b];
    for (var k in BLOCKER_ALIAS) { if (b.indexOf(k) > -1) return BLOCKER_ALIAS[k]; }
    return 'inconsistency';
  }

  /* tidy a free-text goal into a short noun ("I want to become a doctor" → "doctor") */
  function goalNoun(g) {
    g = String(g == null ? '' : g).trim();
    if (!g) return 'your goal';
    g = g.replace(/^i\s+(want|wish|plan|aim|hope|need|would like)\s+to\s+/i, '')
         .replace(/^(become|be|get|reach|build|make|start|achieve|grow|launch|learn|study)\s+(a|an|the|my)?\s*/i, '')
         .replace(/[.!?]+$/, '').trim();
    return g || 'your goal';
  }

  /* ═══════════════════════════════════════════════════════════════
     TEMPLATE LIBRARY — 60 vetted templates
       20 study/career  ·  20 body/fitness  ·  20 business/money
     Each template carries: which arenas it serves, the time buckets &
     energy it suits, blocker tags it answers, and a full proof contract
     (proof_required + 2 good + 2 bad examples + rejection_reasons).
     Titles are verb + object + constraint. why_template references the
     goal. Sensitive (money) proof never asks for account numbers.
  ═══════════════════════════════════════════════════════════════ */
  var TEMPLATES = [

    /* ───────────────── STUDY / CAREER (arena: study) ───────────────── */
    // — CORE —
    { id: 'study-active-recall', arena: 'study', supported_arenas: ['study'], slot: 'core',
      time_buckets: [30, 60], energy: ['normal', 'high'], blocker_tags: ['procrastination', 'no-plan'],
      base_difficulty_1_to_5: 3, base_minutes: 35,
      task_title: 'Answer 10 questions from memory on your weakest topic',
      why_template: 'Active recall is what actually moves grades toward {goal} — not re-reading.',
      steps: ['Pick the topic you understand least.', 'Close your notes and books.', 'Write answers to 10 questions or past-paper points from memory.', 'Open your notes and mark each right or wrong in a different colour.', 'Photograph the answered, corrected page.'],
      proof_required: 'A page of answers written from memory with visible right/wrong corrections.',
      allowed_proof_types: ['photo'],
      proof_examples_good: ['10 numbered answers with red-pen corrections beside them', 'A past-paper question worked out then marked'],
      proof_examples_bad: ['A highlighted textbook page', 'A blank or untouched worksheet'],
      rejection_reasons: ['No answers written from memory (just reading/highlighting)', 'No corrections or marking visible', 'Photo is of notes you copied, not recall'] },

    { id: 'study-sprint', arena: 'study', supported_arenas: ['study'], slot: 'core',
      time_buckets: [30, 60], energy: ['normal', 'high'], blocker_tags: ['procrastination', 'phone'],
      base_difficulty_1_to_5: 3, base_minutes: 40,
      task_title: 'Finish one 30-minute focused study block on {goal}',
      why_template: 'One proven deep block a day is how {goal} gets built — before motivation fades.',
      steps: ['Pick one subject and one clear piece of work.', 'Put your phone in another room or on Do Not Disturb.', 'Set a 30-minute timer and work on only that one thing.', 'When it rings, photograph the work you completed.'],
      proof_required: 'The work you completed during the block — solved problems, written notes, or finished questions.',
      allowed_proof_types: ['photo'],
      proof_examples_good: ['A filled page of worked problems', 'A finished set of questions with the timer beside it'],
      proof_examples_bad: ['A tidy desk with no work shown', 'An open book with nothing written'],
      rejection_reasons: ['No completed work visible', 'Photo shows only a setup, not output', 'Work is clearly copied, not produced in the block'] },

    { id: 'study-summarise', arena: 'study', supported_arenas: ['study'], slot: 'core',
      time_buckets: [30, 60], energy: ['normal', 'high'], blocker_tags: ['no-plan', 'procrastination'],
      base_difficulty_1_to_5: 3, base_minutes: 30,
      task_title: 'Write a one-page summary of a chapter from memory',
      why_template: 'Compressing a chapter into one page forces real understanding toward {goal}.',
      steps: ['Read or revise one chapter or topic.', 'Close it and write a one-page summary from memory.', 'Reopen the source and add anything you missed in another colour.', 'Photograph the completed summary.'],
      proof_required: 'A one-page hand-written or typed summary with from-memory content visible.',
      allowed_proof_types: ['photo', 'screenshot'],
      proof_examples_good: ['A handwritten one-page summary with added corrections', 'A typed summary in your own words'],
      proof_examples_bad: ['A photo of the textbook chapter itself', 'Three highlighted lines called a summary'],
      rejection_reasons: ['Summary is copied verbatim, not in your words', 'Less than a meaningful page of content', 'No evidence the source was closed'] },

    { id: 'study-practice-problems', arena: 'study', supported_arenas: ['study'], slot: 'core',
      time_buckets: [30, 60], energy: ['normal', 'high'], blocker_tags: ['procrastination', 'no-plan'],
      base_difficulty_1_to_5: 3, base_minutes: 35,
      task_title: 'Solve 8 practice problems and mark your mistakes',
      why_template: 'Reps on real problems are what turn study time into marks for {goal}.',
      steps: ['Pick 8 problems at your current level.', 'Work them without looking at solutions first.', 'Check answers and mark each right or wrong.', 'Write one line on what to fix for the wrong ones.', 'Photograph the worked, marked problems.'],
      proof_required: 'Eight worked problems with answers marked right/wrong and fixes noted.',
      allowed_proof_types: ['photo'],
      proof_examples_good: ['8 worked problems with ticks/crosses and fix notes', 'A maths sheet solved then self-marked'],
      proof_examples_bad: ['The problem set with no working shown', 'Answers copied straight from the back of the book'],
      rejection_reasons: ['No working shown for the problems', 'Fewer than the target attempted', 'No self-marking or fixes noted'] },

    { id: 'career-skill-rep', arena: 'study', supported_arenas: ['study', 'money'], slot: 'core',
      time_buckets: [30, 60], energy: ['normal', 'high'], blocker_tags: ['no-plan', 'procrastination'],
      base_difficulty_1_to_5: 3, base_minutes: 40,
      task_title: 'Practise one role skill for 30 minutes and produce a work sample',
      why_template: 'The role behind {goal} is built from repeated skill reps that leave something to show.',
      steps: ['Pick one skill the role needs (writing, coding, design, analysis…).', 'Practise it for 30 minutes on a real, specific task.', 'Produce one sample you could show someone.', 'Photograph or screenshot the finished sample.'],
      proof_required: 'A work sample you produced during the practice — a draft, file, design, or worked answer.',
      allowed_proof_types: ['photo', 'screenshot'],
      proof_examples_good: ['A written practice answer for the role', 'A code snippet or design you produced'],
      proof_examples_bad: ['A tutorial video you watched', 'Notes about the skill with nothing produced'],
      rejection_reasons: ['No sample produced (only consumed content)', 'Sample unrelated to the role', 'Clearly not made today'] },

    { id: 'career-application', arena: 'study', supported_arenas: ['study', 'money'], slot: 'core',
      time_buckets: [30, 60], energy: ['normal', 'high'], blocker_tags: ['fear', 'procrastination'],
      base_difficulty_1_to_5: 4, base_minutes: 40,
      task_title: 'Send one tailored application or outreach message',
      why_template: 'One real, sent move beats a week of planning toward {goal}.',
      steps: ['Pick one real role, person, or opportunity.', 'Tailor your message or application to it specifically.', 'Send or submit it today.', 'Screenshot the sent confirmation or the message in your sent folder.'],
      proof_required: 'A screenshot of the application submitted or the message sent (recipient/platform visible).',
      allowed_proof_types: ['screenshot', 'photo'],
      proof_examples_good: ['A submitted-application confirmation screen', 'A sent outreach email in your sent folder'],
      proof_examples_bad: ['A draft you have not sent', 'A generic message with no specific target'],
      rejection_reasons: ['Message drafted but not sent', 'No recipient or platform visible', 'Generic copy-paste with no tailoring'] },

    { id: 'study-teach-back', arena: 'study', supported_arenas: ['study'], slot: 'core',
      time_buckets: [15, 30], energy: ['normal', 'high'], blocker_tags: ['no-plan'],
      base_difficulty_1_to_5: 3, base_minutes: 20,
      task_title: 'Write a 5-minute explanation of one concept as if teaching it',
      why_template: 'If you can teach it simply, you own it — the fastest test of progress on {goal}.',
      steps: ['Pick one concept you need to know.', 'Write an explanation simple enough for a beginner.', 'Add one example that makes it click.', 'Photograph the written explanation.'],
      proof_required: 'A written beginner-level explanation of the concept, with an example.',
      allowed_proof_types: ['photo', 'screenshot'],
      proof_examples_good: ['A half-page plain-English explanation with an example', 'A "explain like I\'m 5" write-up of a topic'],
      proof_examples_bad: ['A copied textbook definition', 'A single sentence with no example'],
      rejection_reasons: ['Explanation is copied, not in your words', 'No worked example included', 'Too short to demonstrate understanding'] },

    // — MOMENTUM —
    { id: 'study-flashcards-5', arena: 'study', supported_arenas: ['study'], slot: 'momentum',
      time_buckets: [5, 15], energy: ['low', 'normal', 'high'], blocker_tags: ['low-energy', 'procrastination'],
      base_difficulty_1_to_5: 1, base_minutes: 8,
      task_title: 'Make 5 flashcards on today\'s hardest fact',
      why_template: 'Five cards keeps the chain on {goal} alive even on a low day.',
      steps: ['Pick the one fact you keep forgetting.', 'Write 5 question-and-answer flashcards on it.', 'Test yourself once through.', 'Photograph the cards.'],
      proof_required: 'Five visible question/answer flashcards you made today.',
      allowed_proof_types: ['photo', 'screenshot'],
      proof_examples_good: ['5 handwritten Q&A cards laid out', '5 cards made in a flashcard app'],
      proof_examples_bad: ['One card or a blank set', 'A photo of someone else\'s deck'],
      rejection_reasons: ['Fewer than 5 cards', 'No question/answer structure', 'Not made today'] },

    { id: 'study-read-2pages', arena: 'study', supported_arenas: ['study'], slot: 'momentum',
      time_buckets: [5, 15], energy: ['low', 'normal'], blocker_tags: ['low-energy', 'procrastination'],
      base_difficulty_1_to_5: 1, base_minutes: 7,
      task_title: 'Read 2 pages and write one sentence on what they meant',
      why_template: 'Two pages and a sentence keeps momentum on {goal} when energy is low.',
      steps: ['Open your reading where you left off.', 'Read 2 pages properly.', 'Write one sentence capturing the main point.', 'Photograph the sentence beside the pages.'],
      proof_required: 'One written sentence summarising the 2 pages you just read.',
      allowed_proof_types: ['photo', 'screenshot'],
      proof_examples_good: ['A one-line takeaway written under the open book', 'A noted sentence with the page numbers'],
      proof_examples_bad: ['An open book with nothing written', 'A photo of the cover only'],
      rejection_reasons: ['No written takeaway', 'Sentence unrelated to the reading', 'No evidence of the pages read'] },

    { id: 'study-define-3', arena: 'study', supported_arenas: ['study'], slot: 'momentum',
      time_buckets: [5, 15], energy: ['low', 'normal'], blocker_tags: ['low-energy', 'no-plan'],
      base_difficulty_1_to_5: 1, base_minutes: 6,
      task_title: 'Define 3 key terms in your own words',
      why_template: 'Owning the vocabulary of {goal} is a quick, real win for a low day.',
      steps: ['Pick 3 key terms from your subject.', 'Write each definition in your own words.', 'Photograph the three definitions.'],
      proof_required: 'Three terms defined in your own words, written today.',
      allowed_proof_types: ['photo', 'screenshot'],
      proof_examples_good: ['3 terms with plain-English definitions', 'A glossary entry of 3 you wrote'],
      proof_examples_bad: ['Definitions copied word-for-word', 'A list of terms with no definitions'],
      rejection_reasons: ['Definitions copied verbatim', 'Fewer than 3 terms', 'No definitions written'] },

    { id: 'career-cv-line', arena: 'study', supported_arenas: ['study', 'money'], slot: 'momentum',
      time_buckets: [5, 15], energy: ['low', 'normal'], blocker_tags: ['low-energy', 'no-plan'],
      base_difficulty_1_to_5: 1, base_minutes: 10,
      task_title: 'Add or sharpen one line of your CV or portfolio',
      why_template: 'One stronger line moves you closer to {goal} in under ten minutes.',
      steps: ['Open your CV, LinkedIn, or portfolio.', 'Add or rewrite one line so it leads with a result.', 'Save the change.', 'Screenshot the updated line.'],
      proof_required: 'A screenshot of the CV/portfolio line you added or improved today.',
      allowed_proof_types: ['screenshot', 'photo'],
      proof_examples_good: ['A before/after of a rewritten CV bullet', 'A new results-led line on your profile'],
      proof_examples_bad: ['Your whole CV with no change shown', 'A note saying you will do it later'],
      rejection_reasons: ['No actual edit made', 'Change not visible', 'Unrelated to your target role'] },

    { id: 'study-plan-session', arena: 'discipline', supported_arenas: ['study'], slot: 'momentum',
      time_buckets: [5, 15], energy: ['low', 'normal', 'high'], blocker_tags: ['no-plan', 'low-energy'],
      base_difficulty_1_to_5: 1, base_minutes: 5,
      task_title: 'Write the one topic and time for tomorrow\'s study session',
      why_template: 'Deciding tonight removes tomorrow\'s hesitation on {goal}.',
      steps: ['Pick the single topic to study tomorrow.', 'Write the time and place you will do it.', 'Set the first step small enough to start.', 'Photograph the written plan.'],
      proof_required: 'A written plan naming tomorrow\'s topic, time, and first step.',
      allowed_proof_types: ['photo', 'screenshot'],
      proof_examples_good: ['"7pm desk: 30 min — chapter 4 recall" written out', 'A planner line with topic + time'],
      proof_examples_bad: ['A vague "study more" note', 'A 10-item to-do list with no times'],
      rejection_reasons: ['No specific topic named', 'No time or place set', 'Vague goals instead of a session'] },

    { id: 'study-clear-desk', arena: 'discipline', supported_arenas: ['study'], slot: 'momentum',
      time_buckets: [5, 15], energy: ['low', 'normal'], blocker_tags: ['bad-environment', 'procrastination'],
      base_difficulty_1_to_5: 1, base_minutes: 10,
      task_title: 'Clear your study desk and set out tomorrow\'s materials',
      why_template: 'A ready desk lowers the friction to start work on {goal}.',
      steps: ['Clear everything off your study surface.', 'Put back only what you need.', 'Set out tomorrow\'s materials ready to go.', 'Photograph the cleared, ready desk.'],
      proof_required: 'A photo of the cleared desk with tomorrow\'s study materials set out.',
      allowed_proof_types: ['photo'],
      proof_examples_good: ['A before/after of a tidied desk', 'A clear desk with the book and pen ready'],
      proof_examples_bad: ['A messy desk unchanged', 'A photo with no materials set out'],
      rejection_reasons: ['Desk not actually cleared', 'No materials prepared', 'Nothing visibly changed'] },

    // — EDGE —
    { id: 'study-past-paper-timed', arena: 'study', supported_arenas: ['study'], slot: 'edge',
      time_buckets: [30, 60], energy: ['normal', 'high'], blocker_tags: ['fear', 'procrastination'],
      base_difficulty_1_to_5: 4, base_minutes: 45,
      task_title: 'Sit one timed past-paper section under exam conditions',
      why_template: 'Exam-condition reps are the truest rehearsal for {goal}.',
      steps: ['Pick one past-paper section.', 'Set a timer to the real exam length.', 'Work with no notes, no phone, no breaks.', 'Mark it against the scheme afterward.', 'Photograph the completed, marked paper.'],
      proof_required: 'A timed past-paper section completed and marked against the scheme.',
      allowed_proof_types: ['photo'],
      proof_examples_good: ['A past-paper section worked under time then marked', 'A completed exam section with a score noted'],
      proof_examples_bad: ['An untimed open-book attempt', 'A blank past paper'],
      rejection_reasons: ['Not done under time/exam conditions', 'Not marked', 'Notes clearly used'] },

    { id: 'career-mock-interview', arena: 'study', supported_arenas: ['study', 'money'], slot: 'edge',
      time_buckets: [30, 60], energy: ['normal', 'high'], blocker_tags: ['fear', 'confidence'],
      base_difficulty_1_to_5: 3, base_minutes: 30,
      task_title: 'Write and rehearse answers to 3 likely interview questions',
      why_template: 'Rehearsed answers turn nerves into readiness for {goal}.',
      steps: ['Pick 3 questions you\'re likely to be asked.', 'Write a structured answer to each (situation → action → result).', 'Say each answer out loud twice.', 'Photograph your written answers.'],
      proof_required: 'Three written interview answers structured around a real example.',
      allowed_proof_types: ['photo', 'screenshot'],
      proof_examples_good: ['3 STAR-format answers written out', 'Interview prep notes with examples'],
      proof_examples_bad: ['A list of questions with no answers', 'One vague answer'],
      rejection_reasons: ['Fewer than 3 answers', 'Answers have no concrete example', 'Questions only, no answers'] },

    { id: 'study-concept-map', arena: 'study', supported_arenas: ['study'], slot: 'edge',
      time_buckets: [30, 60], energy: ['normal', 'high'], blocker_tags: ['no-plan'],
      base_difficulty_1_to_5: 3, base_minutes: 30,
      task_title: 'Build a concept map linking 6 ideas from one topic',
      why_template: 'Mapping how ideas connect is where shallow study becomes mastery of {goal}.',
      steps: ['Pick one topic.', 'Write its 6 core ideas as nodes.', 'Draw and label the links between them.', 'Photograph the finished map.'],
      proof_required: 'A concept map with at least 6 linked, labelled ideas.',
      allowed_proof_types: ['photo', 'screenshot'],
      proof_examples_good: ['A hand-drawn map with 6+ labelled connections', 'A digital mind-map of a topic'],
      proof_examples_bad: ['A plain list of 6 words', 'A map with no labelled links'],
      rejection_reasons: ['Fewer than 6 ideas', 'No connections drawn/labelled', 'Just a list, not a map'] },

    { id: 'career-portfolio-piece', arena: 'study', supported_arenas: ['study', 'money'], slot: 'edge',
      time_buckets: [60], energy: ['high'], blocker_tags: ['fear', 'no-plan'],
      base_difficulty_1_to_5: 5, base_minutes: 60,
      task_title: 'Create one portfolio-worthy work sample for the role',
      why_template: 'A real portfolio piece is the proof employers behind {goal} actually want.',
      steps: ['Pick a skill central to the role.', 'Choose one small but complete piece to make.', 'Build it start to finish to a standard you\'d show.', 'Save/export it.', 'Screenshot or photograph the finished piece.'],
      proof_required: 'A finished, show-able work sample for your target role.',
      allowed_proof_types: ['photo', 'screenshot'],
      proof_examples_good: ['A finished project export', 'A completed writing/design sample'],
      proof_examples_bad: ['A rough unfinished draft', 'A reference you saved from someone else'],
      rejection_reasons: ['Piece unfinished', 'Not your own work', 'Not relevant to the role'] },

    { id: 'study-error-log', arena: 'study', supported_arenas: ['study'], slot: 'edge',
      time_buckets: [30, 60], energy: ['normal', 'high'], blocker_tags: ['no-plan', 'procrastination'],
      base_difficulty_1_to_5: 3, base_minutes: 30,
      task_title: 'Review last week\'s mistakes and write the fix for each',
      why_template: 'Closing the loop on past mistakes is the highest-leverage hour for {goal}.',
      steps: ['Gather last week\'s wrong answers or feedback.', 'For each, write why it was wrong.', 'Write the specific fix or rule to remember.', 'Photograph the completed error log.'],
      proof_required: 'An error log pairing each past mistake with its cause and fix.',
      allowed_proof_types: ['photo', 'screenshot'],
      proof_examples_good: ['A table of mistake → why → fix', 'Marked errors with fixes written beside them'],
      proof_examples_bad: ['A list of wrong answers with no fixes', 'A blank template'],
      rejection_reasons: ['No fixes written', 'No real past mistakes reviewed', 'Causes not identified'] },

    { id: 'career-network-message', arena: 'study', supported_arenas: ['study', 'money'], slot: 'edge',
      time_buckets: [15, 30], energy: ['normal', 'high'], blocker_tags: ['fear', 'confidence'],
      base_difficulty_1_to_5: 3, base_minutes: 20,
      task_title: 'Send one thoughtful message to someone in your target field',
      why_template: 'One real connection opens doors that applications to {goal} can\'t.',
      steps: ['Find one person working in your target field.', 'Write a short, specific, non-needy message.', 'Send it today.', 'Screenshot the sent message (hide their private details).'],
      proof_required: 'A screenshot of a thoughtful, sent message to someone in your field.',
      allowed_proof_types: ['screenshot'],
      proof_examples_good: ['A sent LinkedIn message asking one specific question', 'A polite outreach DM in your sent items'],
      proof_examples_bad: ['A draft not sent', 'A generic "hi" with no substance'],
      rejection_reasons: ['Message not sent', 'Generic with no specificity', 'No evidence it was sent'] },

    { id: 'study-deep-read', arena: 'study', supported_arenas: ['study'], slot: 'edge',
      time_buckets: [30, 60], energy: ['normal', 'high'], blocker_tags: ['phone', 'procrastination'],
      base_difficulty_1_to_5: 3, base_minutes: 35,
      task_title: 'Read and annotate one full article, noting 3 questions',
      why_template: 'Deep, questioning reading is how understanding of {goal} gets real depth.',
      steps: ['Pick one article or section central to your goal.', 'Read it with your phone away.', 'Annotate as you go.', 'Write 3 questions it raised.', 'Photograph the annotations and questions.'],
      proof_required: 'An annotated reading with 3 written questions it raised.',
      allowed_proof_types: ['photo', 'screenshot'],
      proof_examples_good: ['A marked-up article with 3 questions noted', 'Annotated pages plus a question list'],
      proof_examples_bad: ['A clean unread article', 'Annotations with no questions'],
      rejection_reasons: ['No annotations', 'Fewer than 3 questions', 'No evidence of real reading'] },

    /* ───────────────── BODY / FITNESS (arena: fitness) ───────────────── */
    // — CORE —
    { id: 'fitness-training-session', arena: 'fitness', supported_arenas: ['fitness'], slot: 'core',
      time_buckets: [30, 60], energy: ['normal', 'high'], blocker_tags: ['procrastination', 'inconsistency'],
      base_difficulty_1_to_5: 3, base_minutes: 35,
      task_title: 'Complete one 30-minute training session',
      why_template: '{goal} is built one finished session at a time — consistency beats intensity.',
      steps: ['Choose gym, run, sport, or a home workout.', 'Train for at least 30 minutes.', 'Just finish it — don\'t chase a perfect session.', 'Take proof right after training.'],
      proof_required: 'Evidence of the session you just did — workout log, equipment used, or a fitness-app summary.',
      allowed_proof_types: ['photo', 'screenshot'],
      proof_examples_good: ['A logged workout in a tracking app', 'Gym equipment or a run summary from today'],
      proof_examples_bad: ['An old or generic mirror selfie', 'A photo of the gym entrance with no session'],
      rejection_reasons: ['No evidence a session happened', 'Clearly an old photo', 'Generic image unrelated to training'] },

    { id: 'fitness-strength-lift', arena: 'fitness', supported_arenas: ['fitness'], slot: 'core',
      time_buckets: [30, 60], energy: ['normal', 'high'], blocker_tags: ['procrastination'],
      base_difficulty_1_to_5: 4, base_minutes: 45,
      task_title: 'Train one muscle group with 4 working sets to near-failure',
      why_template: 'Hard, honest working sets are what actually build the body behind {goal}.',
      steps: ['Pick one muscle group and one main lift.', 'Warm up, then do 4 working sets near failure.', 'Log the weight and reps for each set.', 'Photograph your logged sets.'],
      proof_required: 'A log of 4 working sets with weight and reps recorded today.',
      allowed_proof_types: ['photo', 'screenshot'],
      proof_examples_good: ['A workout app showing 4 sets logged', 'A handwritten set/rep log dated today'],
      proof_examples_bad: ['An empty log', 'A gym selfie with no sets recorded'],
      rejection_reasons: ['No sets logged', 'Fewer than the target sets', 'Not recorded today'] },

    { id: 'fitness-conditioning', arena: 'fitness', supported_arenas: ['fitness'], slot: 'core',
      time_buckets: [15, 30], energy: ['normal', 'high'], blocker_tags: ['procrastination', 'inconsistency'],
      base_difficulty_1_to_5: 3, base_minutes: 20,
      task_title: 'Complete a 20-minute conditioning circuit or run',
      why_template: 'Conditioning builds the engine everything else in {goal} runs on.',
      steps: ['Pick a run, row, or bodyweight circuit.', 'Work for 20 minutes at a real effort.', 'Note distance, rounds, or time.', 'Screenshot or photograph the result.'],
      proof_required: 'A logged conditioning result — distance, rounds, or a fitness-app summary from today.',
      allowed_proof_types: ['photo', 'screenshot'],
      proof_examples_good: ['A run-tracker summary from today', 'A circuit written with rounds completed'],
      proof_examples_bad: ['Yesterday\'s run screenshot', 'A photo of running shoes with no session'],
      rejection_reasons: ['No result logged', 'Old data reused', 'No evidence of effort today'] },

    { id: 'fitness-skill-drill', arena: 'fitness', supported_arenas: ['fitness'], slot: 'core',
      time_buckets: [30, 60], energy: ['normal', 'high'], blocker_tags: ['no-plan', 'procrastination'],
      base_difficulty_1_to_5: 3, base_minutes: 30,
      task_title: 'Do 30 minutes of focused skill drills for your sport',
      why_template: 'Deliberate drills, not a kickabout, are what sharpen {goal}.',
      steps: ['Pick one skill to sharpen (control, shooting, footwork…).', 'Do focused reps for 30 minutes.', 'Note the reps or sets done.', 'Photograph the drill setup or your rep notes.'],
      proof_required: 'Evidence of focused drilling — kit/ball set up, or notes of the reps done today.',
      allowed_proof_types: ['photo', 'screenshot'],
      proof_examples_good: ['Cones and ball set up with rep count noted', 'A drill log of sets completed'],
      proof_examples_bad: ['An unrelated or old photo', 'A photo of the pitch with no drill'],
      rejection_reasons: ['No evidence of drilling', 'No reps/sets noted', 'Old or unrelated image'] },

    { id: 'fitness-mobility-flow', arena: 'fitness', supported_arenas: ['fitness'], slot: 'core',
      time_buckets: [15, 30], energy: ['low', 'normal'], blocker_tags: ['low-energy', 'inconsistency'],
      base_difficulty_1_to_5: 2, base_minutes: 20,
      task_title: 'Complete a 20-minute mobility and stretching flow',
      why_template: 'Mobility keeps you training week after week toward {goal}.',
      steps: ['Pick a mobility flow for your tightest areas.', 'Move through it for 20 minutes.', 'Note which areas you worked.', 'Photograph your mat/setup or a written log.'],
      proof_required: 'Evidence of a real mobility session — your setup or a written log from today.',
      allowed_proof_types: ['photo'],
      proof_examples_good: ['A mat set up mid-flow', 'A short log of the areas mobilised'],
      proof_examples_bad: ['An empty room with no session', 'A stock stretching image'],
      rejection_reasons: ['No real session shown', 'Generic/stock image', 'No areas or routine noted'] },

    { id: 'fitness-protein-day', arena: 'fitness', supported_arenas: ['fitness'], slot: 'core',
      time_buckets: [15, 30, 60], energy: ['low', 'normal', 'high'], blocker_tags: ['inconsistency', 'no-plan'],
      base_difficulty_1_to_5: 2, base_minutes: 15,
      task_title: 'Hit your protein target and log every meal today',
      why_template: 'Nutrition decides whether training turns into the body behind {goal}.',
      steps: ['Set your protein target for the day.', 'Log each meal as you eat it.', 'Adjust to hit the target by evening.', 'Screenshot the completed day\'s log.'],
      proof_required: 'A meal/protein log for today showing the target met.',
      allowed_proof_types: ['screenshot', 'photo'],
      proof_examples_good: ['A nutrition-app day showing protein hit', 'A written meal log totalling the target'],
      proof_examples_bad: ['An empty tracker', 'Yesterday\'s log'],
      rejection_reasons: ['No log for today', 'Target not actually tracked', 'Reused old data'] },

    { id: 'fitness-home-workout', arena: 'fitness', supported_arenas: ['fitness'], slot: 'core',
      time_buckets: [15, 30], energy: ['normal', 'high'], blocker_tags: ['bad-environment', 'time'],
      base_difficulty_1_to_5: 3, base_minutes: 25,
      task_title: 'Do a 25-minute bodyweight workout with no equipment',
      why_template: 'No gym, no excuse — a home session still moves {goal} forward.',
      steps: ['Pick 4 bodyweight moves (squats, push-ups, lunges, plank).', 'Do 3 rounds, working for 25 minutes.', 'Note rounds and reps.', 'Photograph your written log or workout space mid-session.'],
      proof_required: 'A log of the bodyweight rounds/reps completed today.',
      allowed_proof_types: ['photo', 'screenshot'],
      proof_examples_good: ['A written 3-round log with reps', 'A workout-app home session logged'],
      proof_examples_bad: ['An empty living room', 'A plan with nothing completed'],
      rejection_reasons: ['No rounds/reps logged', 'Only a plan, no session', 'No evidence of today'] },

    // — MOMENTUM —
    { id: 'fitness-walk-10', arena: 'fitness', supported_arenas: ['fitness'], slot: 'momentum',
      time_buckets: [5, 15], energy: ['low', 'normal', 'high'], blocker_tags: ['low-energy', 'inconsistency'],
      base_difficulty_1_to_5: 1, base_minutes: 10,
      task_title: 'Take a brisk 10-minute walk',
      why_template: 'Ten minutes of movement protects momentum on {goal} on a low day.',
      steps: ['Step outside or onto a treadmill.', 'Walk briskly for 10 minutes.', 'Track it on your phone or watch.', 'Screenshot the walk summary.'],
      proof_required: 'A screenshot of today\'s 10-minute walk (time/distance visible).',
      allowed_proof_types: ['screenshot', 'photo'],
      proof_examples_good: ['A walk tracked at ~10 min today', 'A step/walk summary with today\'s date'],
      proof_examples_bad: ['A past walk screenshot', 'A photo of shoes with no walk'],
      rejection_reasons: ['No walk recorded today', 'Reused old data', 'No time/distance shown'] },

    { id: 'fitness-steps-check', arena: 'fitness', supported_arenas: ['fitness'], slot: 'momentum',
      time_buckets: [5, 15], energy: ['low', 'normal', 'high'], blocker_tags: ['low-energy', 'inconsistency'],
      base_difficulty_1_to_5: 1, base_minutes: 5,
      task_title: 'Hit and screenshot 8,000 steps today',
      why_template: 'Daily steps hold your baseline between sessions toward {goal}.',
      steps: ['Aim for 8,000+ steps across the day.', 'Take the longer route or walk after a meal.', 'Check your phone or watch count.', 'Screenshot the total once you hit it.'],
      proof_required: 'A screenshot of today\'s step count at 8,000+ (date visible).',
      allowed_proof_types: ['screenshot'],
      proof_examples_good: ['A step counter at 8k+ dated today', 'A watch step ring closed at 8,000+ today'],
      proof_examples_bad: ['A past day\'s step total', 'A count well under target'],
      rejection_reasons: ['Step count below target', 'Past day\'s total', 'Date not visible'] },

    { id: 'fitness-weigh-log', arena: 'fitness', supported_arenas: ['fitness'], slot: 'momentum',
      time_buckets: [5], energy: ['low', 'normal', 'high'], blocker_tags: ['low-energy', 'inconsistency'],
      base_difficulty_1_to_5: 1, base_minutes: 5,
      task_title: 'Weigh in and log your bodyweight this morning',
      why_template: 'A daily data point keeps {goal} honest and shows the trend, not the noise.',
      steps: ['Step on the scale first thing, same conditions as usual.', 'Log the number in your tracker or a note.', 'Glance at the weekly trend, not one day.', 'Screenshot the logged entry.'],
      proof_required: 'A bodyweight entry logged today in a tracker or note.',
      allowed_proof_types: ['screenshot', 'photo'],
      proof_examples_good: ['A weight-tracker entry dated today', 'A note of today\'s weigh-in with the trend'],
      proof_examples_bad: ['An empty tracker', 'Yesterday\'s entry reused'],
      rejection_reasons: ['No entry logged today', 'Reused old data', 'No number recorded'] },

    { id: 'fitness-water-log', arena: 'fitness', supported_arenas: ['fitness'], slot: 'momentum',
      time_buckets: [5], energy: ['low', 'normal'], blocker_tags: ['low-energy'],
      base_difficulty_1_to_5: 1, base_minutes: 5,
      task_title: 'Drink and log 2 glasses of water now',
      why_template: 'Hydration is the easiest lever for the energy {goal} needs.',
      steps: ['Fill 2 glasses or a bottle.', 'Drink them now.', 'Log it in your tracker or a note.', 'Photograph the log or the empty glasses.'],
      proof_required: 'A photo or log of the water you drank today.',
      allowed_proof_types: ['photo', 'screenshot'],
      proof_examples_good: ['A hydration tracker updated today', 'Two empty glasses with a logged note'],
      proof_examples_bad: ['A full untouched bottle', 'A blank tracker'],
      rejection_reasons: ['No log or evidence', 'Nothing actually consumed', 'Reused old log'] },

    { id: 'fitness-stretch-5', arena: 'fitness', supported_arenas: ['fitness'], slot: 'momentum',
      time_buckets: [5, 15], energy: ['low', 'normal'], blocker_tags: ['low-energy'],
      base_difficulty_1_to_5: 1, base_minutes: 5,
      task_title: 'Do a 5-minute stretch for your tightest area',
      why_template: 'Five minutes of stretching keeps the body ready for {goal}.',
      steps: ['Pick your tightest area today.', 'Stretch it gently for 5 minutes.', 'Note how it felt.', 'Photograph your stretch setup or a note of what you did.'],
      proof_required: 'Evidence of a 5-minute stretch done today — setup or a written note.',
      allowed_proof_types: ['photo'],
      proof_examples_good: ['A mat set up with the area noted', 'A short note of the stretch done'],
      proof_examples_bad: ['An empty room', 'A stock stretching photo'],
      rejection_reasons: ['No real stretch shown', 'Stock/generic image', 'No note of what was done'] },

    { id: 'fitness-pushups-set', arena: 'fitness', supported_arenas: ['fitness'], slot: 'momentum',
      time_buckets: [5], energy: ['normal', 'high'], blocker_tags: ['inconsistency', 'low-energy'],
      base_difficulty_1_to_5: 1, base_minutes: 5,
      task_title: 'Do one max set of push-ups and note the number',
      why_template: 'One honest set keeps the streak on {goal} alive in five minutes.',
      steps: ['Drop and do push-ups to a clean limit.', 'Count the reps.', 'Write the number down.', 'Photograph the noted number.'],
      proof_required: 'A written rep count from your max push-up set today.',
      allowed_proof_types: ['photo', 'screenshot'],
      proof_examples_good: ['A noted rep count dated today', 'A workout-app set of push-ups logged'],
      proof_examples_bad: ['A blank note', 'A photo of the floor with no count'],
      rejection_reasons: ['No rep count noted', 'Not done today', 'No evidence of the set'] },

    { id: 'fitness-prep-kit', arena: 'discipline', supported_arenas: ['fitness'], slot: 'momentum',
      time_buckets: [5, 15], energy: ['low', 'normal'], blocker_tags: ['bad-environment', 'procrastination'],
      base_difficulty_1_to_5: 1, base_minutes: 7,
      task_title: 'Pack your training kit ready for tomorrow',
      why_template: 'Kit ready by the door removes tomorrow\'s excuse against {goal}.',
      steps: ['Gather tomorrow\'s training clothes and shoes.', 'Pack your bottle and any kit.', 'Set it by the door or your bed.', 'Photograph the packed, ready kit.'],
      proof_required: 'A photo of your training kit packed and set out for tomorrow.',
      allowed_proof_types: ['photo'],
      proof_examples_good: ['A packed gym bag by the door', 'Kit laid out ready for the morning'],
      proof_examples_bad: ['A messy pile of clothes', 'An empty bag'],
      rejection_reasons: ['Kit not actually packed', 'Nothing set out', 'No evidence of preparation'] },

    // — EDGE —
    { id: 'fitness-progressive-overload', arena: 'fitness', supported_arenas: ['fitness'], slot: 'edge',
      time_buckets: [30, 60], energy: ['high'], blocker_tags: ['inconsistency'],
      base_difficulty_1_to_5: 4, base_minutes: 45,
      task_title: 'Add weight or reps to one lift vs last session and log it',
      why_template: 'Progressive overload is the engine of real change toward {goal}.',
      steps: ['Check last session\'s numbers for one lift.', 'Add weight or reps today.', 'Complete the sets with good form.', 'Log the new numbers beside the old.', 'Screenshot the comparison.'],
      proof_required: 'A log showing today\'s lift beating last session\'s weight or reps.',
      allowed_proof_types: ['screenshot', 'photo'],
      proof_examples_good: ['A workout app showing an increase vs last time', 'A log with old vs new numbers'],
      proof_examples_bad: ['A log with no comparison', 'Identical numbers to last time'],
      rejection_reasons: ['No progression shown', 'No prior session to compare', 'Not logged today'] },

    { id: 'fitness-form-check', arena: 'fitness', supported_arenas: ['fitness'], slot: 'edge',
      time_buckets: [15, 30], energy: ['normal', 'high'], blocker_tags: ['no-plan'],
      base_difficulty_1_to_5: 3, base_minutes: 20,
      task_title: 'Film one set, check your form, and note one fix',
      why_template: 'Fixing form is what makes the work pay off for {goal}.',
      steps: ['Pick one lift or movement.', 'Film one set from the side.', 'Compare it to a good form cue.', 'Write the one thing to fix next time.', 'Screenshot your note (not the video of others).'],
      proof_required: 'A written form note identifying one specific fix from today\'s set.',
      allowed_proof_types: ['photo', 'screenshot'],
      proof_examples_good: ['"Squat: knees caving — cue knees out" written', 'A form note with the lift and fix'],
      proof_examples_bad: ['A note with no specific fix', 'A generic "improve form" line'],
      rejection_reasons: ['No specific fix identified', 'No real set reviewed', 'Vague note'] },

    { id: 'fitness-meal-prep', arena: 'fitness', supported_arenas: ['fitness'], slot: 'edge',
      time_buckets: [30, 60], energy: ['normal', 'high'], blocker_tags: ['no-plan', 'time'],
      base_difficulty_1_to_5: 3, base_minutes: 35,
      task_title: 'Prep one high-protein meal for tomorrow',
      why_template: 'Tomorrow\'s nutrition decided today keeps {goal} on track.',
      steps: ['Pick a high-protein meal.', 'Cook or assemble it.', 'Portion and store it for tomorrow.', 'Photograph the prepped meal.'],
      proof_required: 'A photo of the high-protein meal you prepped and stored for tomorrow.',
      allowed_proof_types: ['photo'],
      proof_examples_good: ['A portioned meal in a container', 'Prepped food ready in the fridge'],
      proof_examples_bad: ['A photo of raw groceries only', 'A meal you ate now, not prepped'],
      rejection_reasons: ['Nothing actually prepped/stored', 'Just groceries, not a meal', 'No evidence of prep'] },

    { id: 'fitness-recovery-protocol', arena: 'discipline', supported_arenas: ['fitness'], slot: 'edge',
      time_buckets: [15, 30], energy: ['low', 'normal'], blocker_tags: ['low-energy', 'inconsistency'],
      base_difficulty_1_to_5: 2, base_minutes: 20,
      task_title: 'Complete a wind-down: stretch, hydrate, screens off by a set time',
      why_template: 'Recovery and sleep raise tomorrow\'s energy for {goal}.',
      steps: ['Set a screen cut-off time tonight.', 'Stretch and hydrate.', 'Prep your room: lights low, alarm set.', 'Photograph the wind-down setup (alarm, water, book).'],
      proof_required: 'A photo of your wind-down setup — screen cut-off, hydration, or sleep prep done today.',
      allowed_proof_types: ['photo', 'screenshot'],
      proof_examples_good: ['Alarm set with phone on Do Not Disturb', 'Water and book by the bed, lights low'],
      proof_examples_bad: ['A photo showing nothing about a routine', 'A screen still in active use'],
      rejection_reasons: ['No wind-down setup shown', 'Nothing prepared', 'Anything private or unsafe'] },

    { id: 'fitness-interval-session', arena: 'fitness', supported_arenas: ['fitness'], slot: 'edge',
      time_buckets: [30, 60], energy: ['high'], blocker_tags: ['inconsistency'],
      base_difficulty_1_to_5: 4, base_minutes: 30,
      task_title: 'Complete a structured interval session (e.g. 6×1 min hard)',
      why_template: 'Structured intervals build the conditioning {goal} demands.',
      steps: ['Pick an interval format (e.g. 6×1 min hard / 1 min easy).', 'Warm up, then complete every interval.', 'Track it on an app or watch.', 'Screenshot the session summary.'],
      proof_required: 'A fitness-app summary of the interval session completed today.',
      allowed_proof_types: ['screenshot', 'photo'],
      proof_examples_good: ['An interval workout summary from today', 'A logged session showing the intervals'],
      proof_examples_bad: ['A steady walk labelled intervals', 'Yesterday\'s session'],
      rejection_reasons: ['No intervals shown', 'Reused old data', 'No session logged today'] },

    { id: 'fitness-sleep-window', arena: 'discipline', supported_arenas: ['fitness'], slot: 'edge',
      time_buckets: [5, 15], energy: ['low', 'normal'], blocker_tags: ['low-energy', 'phone'],
      base_difficulty_1_to_5: 2, base_minutes: 10,
      task_title: 'Set a sleep window and prep your room for it',
      why_template: 'A consistent sleep window is the foundation under {goal}.',
      steps: ['Decide tonight\'s sleep and wake times.', 'Set an alarm and a phone wind-down.', 'Prep your room for that time.', 'Screenshot the alarm/wind-down setting.'],
      proof_required: 'A screenshot of the sleep window or wind-down setting you set for tonight.',
      allowed_proof_types: ['screenshot', 'photo'],
      proof_examples_good: ['An alarm set with a bedtime reminder', 'A phone wind-down schedule enabled'],
      proof_examples_bad: ['No setting actually changed', 'A blank clock app'],
      rejection_reasons: ['No window/setting set', 'Nothing changed', 'No evidence of prep'] },

    /* ───────────────── BUSINESS / MONEY (arena: money) ─────────────────
       Money is treated as sensitive: proof never asks for account numbers,
       balances, logins, or anyone else's private details. */
    // — CORE —
    { id: 'money-build-output', arena: 'money', supported_arenas: ['money'], slot: 'core',
      time_buckets: [60], energy: ['high'], blocker_tags: ['procrastination', 'no-plan'],
      base_difficulty_1_to_5: 5, base_minutes: 60,
      task_title: 'Build one shippable piece of your product or offer',
      why_template: '{goal} is a stack of shipped outputs, not plans — build one today.',
      steps: ['Pick one piece: a page, feature, design, or offer.', 'Build the smallest complete version.', 'Save or publish it.', 'Screenshot the output you made.'],
      proof_required: 'A screenshot of a real output you built today — a section, feature, design, or draft.',
      allowed_proof_types: ['screenshot', 'photo'],
      proof_examples_good: ['A finished landing-page section', 'A feature or design you exported today'],
      proof_examples_bad: ['A course you watched about building', 'Notes about what you plan to build'],
      rejection_reasons: ['No output built (only consumed/planned)', 'Not made today', 'Not your own work'] },

    { id: 'money-outreach-5', arena: 'money', supported_arenas: ['money'], slot: 'core',
      time_buckets: [15, 30], energy: ['normal', 'high'], blocker_tags: ['fear', 'confidence'],
      base_difficulty_1_to_5: 3, base_minutes: 25,
      task_title: 'Send 5 specific outreach messages to real leads',
      why_template: 'Revenue toward {goal} follows real conversations — send five today.',
      steps: ['List 5 real people or businesses.', 'Write a short, specific message to each.', 'Send all 5 today.', 'Screenshot the sent messages (hide their private details).'],
      proof_required: 'A screenshot of 5 real, sent outreach messages (recipients/platform visible, private info hidden).',
      allowed_proof_types: ['screenshot'],
      proof_examples_good: ['5 DMs in your sent folder', '5 cold emails sent today'],
      proof_examples_bad: ['Drafts not sent', 'Messages to nobody real'],
      rejection_reasons: ['Messages not sent', 'Fewer than 5', 'Generic spam with no specificity'] },

    { id: 'money-skill-build', arena: 'money', supported_arenas: ['money'], slot: 'core',
      time_buckets: [30, 60], energy: ['normal', 'high'], blocker_tags: ['no-plan', 'procrastination'],
      base_difficulty_1_to_5: 3, base_minutes: 35,
      task_title: 'Spend 30 minutes building the skill that earns, and produce output',
      why_template: 'Money follows a skill — {goal} needs you producing, not watching.',
      steps: ['Pick the one skill that drives income (sales, copy, code, design…).', 'Work on a real task for 30 minutes.', 'Produce one visible output.', 'Screenshot or photograph what you made.'],
      proof_required: 'A visible output you produced while building the skill today.',
      allowed_proof_types: ['screenshot', 'photo'],
      proof_examples_good: ['A piece of copy you wrote', 'A design or build you produced today'],
      proof_examples_bad: ['A tutorial you watched', 'Notes with nothing produced'],
      rejection_reasons: ['No output produced', 'Only consumed content', 'Not made today'] },

    { id: 'money-sharpen-offer', arena: 'money', supported_arenas: ['money'], slot: 'core',
      time_buckets: [15, 30], energy: ['normal', 'high'], blocker_tags: ['no-plan'],
      base_difficulty_1_to_5: 3, base_minutes: 20,
      task_title: 'Write your offer in one sentence: who, result, and price',
      why_template: 'A sharp offer makes everything about {goal} easier to sell.',
      steps: ['Write who it is for.', 'Write the specific result they get.', 'Cut it to one clear sentence.', 'Note the price or next step.', 'Photograph or screenshot the written offer.'],
      proof_required: 'A one-sentence offer naming who it is for, the result, and a price/next step.',
      allowed_proof_types: ['photo', 'screenshot'],
      proof_examples_good: ['"I help X get Y in Z, for $N" written out', 'An offer line with price noted'],
      proof_examples_bad: ['A vague mission statement', 'A copied offer with no specifics'],
      rejection_reasons: ['No clear who/result', 'Vague or generic', 'No price or next step'] },

    { id: 'money-income-action', arena: 'money', supported_arenas: ['money'], slot: 'core',
      time_buckets: [30, 60], energy: ['normal', 'high'], blocker_tags: ['fear', 'procrastination'],
      base_difficulty_1_to_5: 4, base_minutes: 30,
      task_title: 'Take one income action: list, invoice, pitch, or apply for paid work',
      why_template: 'Saving has a floor; earning toward {goal} does not — act today.',
      steps: ['Pick one: list an item, send an invoice, pitch a client, or apply for paid work.', 'Make it specific and real.', 'Do it today.', 'Screenshot the action (hide any private numbers).'],
      proof_required: 'A screenshot of a real income action taken today — listing live, invoice sent, or paid work applied for.',
      allowed_proof_types: ['screenshot', 'photo'],
      proof_examples_good: ['A marketplace listing now live', 'An invoice sent (amounts can be hidden)'],
      proof_examples_bad: ['An action only considered, not done', 'A screenshot exposing account numbers'],
      rejection_reasons: ['Action not actually taken', 'Only planned', 'Exposes private financial details'] },

    { id: 'money-content-piece', arena: 'money', supported_arenas: ['money'], slot: 'core',
      time_buckets: [30, 60], energy: ['normal', 'high'], blocker_tags: ['procrastination', 'fear'],
      base_difficulty_1_to_5: 4, base_minutes: 40,
      task_title: 'Create one piece of content for your channel or brand',
      why_template: 'Channels behind {goal} grow on volume of reps, not one viral hope.',
      steps: ['Pick one piece: a script, clip, post, or thumbnail.', 'Make the smallest complete version.', 'Save it.', 'Screenshot the content you made.'],
      proof_required: 'A screenshot of content you created today — a script, clip, edit, or draft post.',
      allowed_proof_types: ['screenshot', 'photo'],
      proof_examples_good: ['A written script', 'A recorded clip or finished thumbnail'],
      proof_examples_bad: ['Other people\'s content you watched', 'An empty editor'],
      rejection_reasons: ['No content produced', 'Consumed, not created', 'Not made today'] },

    { id: 'money-track-budget', arena: 'money', supported_arenas: ['money'], slot: 'core',
      time_buckets: [5, 15], energy: ['low', 'normal'], blocker_tags: ['no-plan', 'low-energy'],
      base_difficulty_1_to_5: 2, base_minutes: 12,
      task_title: 'Log today\'s spending and note one number to improve',
      why_template: 'Awareness is the first money habit behind {goal} — tracking beats guessing.',
      steps: ['Open your notes or a budgeting app.', 'Log today\'s spending or a no-spend day.', 'Note one number you want to improve.', 'Screenshot the log with account numbers hidden.'],
      proof_required: 'A spending/no-spend log for today with one improvement noted — no account numbers shown.',
      allowed_proof_types: ['screenshot', 'photo'],
      proof_examples_good: ['A dated expense list with a target noted', 'A no-spend note for today'],
      proof_examples_bad: ['A screenshot showing full account numbers', 'Invented figures'],
      rejection_reasons: ['No real entry for today', 'Exposes account numbers/logins', 'Figures clearly invented'] },

    // — MOMENTUM —
    { id: 'money-dm-1', arena: 'money', supported_arenas: ['money'], slot: 'momentum',
      time_buckets: [5, 15], energy: ['low', 'normal'], blocker_tags: ['fear', 'confidence'],
      base_difficulty_1_to_5: 1, base_minutes: 8,
      task_title: 'Send one warm message to a potential customer or collaborator',
      why_template: 'One real message keeps the pipeline for {goal} moving on a low day.',
      steps: ['Pick one warm contact or lead.', 'Write a short, genuine message.', 'Send it now.', 'Screenshot the sent message (hide private details).'],
      proof_required: 'A screenshot of one genuine, sent message to a real contact today.',
      allowed_proof_types: ['screenshot'],
      proof_examples_good: ['A warm DM in your sent items', 'A short, specific message sent today'],
      proof_examples_bad: ['A draft not sent', 'A mass-blast with no personalisation'],
      rejection_reasons: ['Message not sent', 'No real recipient', 'No evidence it was sent'] },

    { id: 'money-idea-bank', arena: 'money', supported_arenas: ['money'], slot: 'momentum',
      time_buckets: [5, 15], energy: ['low', 'normal'], blocker_tags: ['no-plan', 'low-energy'],
      base_difficulty_1_to_5: 1, base_minutes: 10,
      task_title: 'Write 3 specific content or offer ideas with a hook each',
      why_template: 'A stocked idea bank means you never stall on {goal} from a blank page.',
      steps: ['Write 3 specific ideas for content or offers.', 'Give each a one-line hook or angle.', 'Pick tomorrow\'s one.', 'Photograph the idea list.'],
      proof_required: 'Three specific ideas, each with a written hook or angle.',
      allowed_proof_types: ['photo', 'screenshot'],
      proof_examples_good: ['3 titles each with a hook', '3 offer angles written out'],
      proof_examples_bad: ['3 vague one-word topics', 'A single idea'],
      rejection_reasons: ['Fewer than 3 ideas', 'No hooks/angles', 'Too vague to act on'] },

    { id: 'money-cut-leak', arena: 'money', supported_arenas: ['money'], slot: 'momentum',
      time_buckets: [5, 15], energy: ['low', 'normal'], blocker_tags: ['no-plan', 'low-energy'],
      base_difficulty_1_to_5: 1, base_minutes: 10,
      task_title: 'Cancel or pause one unnecessary subscription',
      why_template: 'Plugging one leak is faster than earning it back toward {goal}.',
      steps: ['Find one subscription you don\'t need.', 'Cancel, pause, or downgrade it.', 'Note what you saved per month.', 'Screenshot the cancellation/change confirmation.'],
      proof_required: 'A screenshot confirming a subscription cancelled, paused, or downgraded today.',
      allowed_proof_types: ['screenshot', 'photo'],
      proof_examples_good: ['A cancellation confirmation email/screen', 'A downgrade confirmed in an app'],
      proof_examples_bad: ['A subscription list with no change', 'A note to do it later'],
      rejection_reasons: ['Nothing actually changed', 'No confirmation shown', 'Exposes payment card details'] },

    { id: 'money-followup', arena: 'money', supported_arenas: ['money'], slot: 'momentum',
      time_buckets: [5, 15], energy: ['low', 'normal'], blocker_tags: ['fear', 'procrastination'],
      base_difficulty_1_to_5: 1, base_minutes: 8,
      task_title: 'Send one follow-up to a lead who went quiet',
      why_template: 'Follow-ups close more of {goal} than first messages ever do.',
      steps: ['Find one lead who went quiet.', 'Write a short, no-pressure follow-up.', 'Send it today.', 'Screenshot the sent follow-up.'],
      proof_required: 'A screenshot of a follow-up message sent to a real lead today.',
      allowed_proof_types: ['screenshot'],
      proof_examples_good: ['A polite follow-up in your sent items', 'A "circling back" message sent today'],
      proof_examples_bad: ['A draft not sent', 'A first message, not a follow-up'],
      rejection_reasons: ['Not sent', 'No real lead', 'No evidence of sending'] },

    { id: 'money-no-spend', arena: 'money', supported_arenas: ['money'], slot: 'momentum',
      time_buckets: [5], energy: ['low', 'normal', 'high'], blocker_tags: ['low-energy', 'inconsistency'],
      base_difficulty_1_to_5: 1, base_minutes: 5,
      task_title: 'Commit to and note a no-spend block for today',
      why_template: 'A no-spend block builds the discipline {goal} rests on.',
      steps: ['Decide a no-spend window (today, or this evening).', 'Write the commitment down.', 'Note what you would have spent on.', 'Photograph the written no-spend note.'],
      proof_required: 'A written no-spend commitment for today with the temptation noted.',
      allowed_proof_types: ['photo', 'screenshot'],
      proof_examples_good: ['"No-spend today — skipping the coffee run" written', 'A dated no-spend note'],
      proof_examples_bad: ['A blank note', 'A receipt showing you spent'],
      rejection_reasons: ['No commitment written', 'Not dated today', 'Evidence of spending instead'] },

    { id: 'money-tidy-pipeline', arena: 'discipline', supported_arenas: ['money'], slot: 'momentum',
      time_buckets: [5, 15], energy: ['low', 'normal'], blocker_tags: ['no-plan', 'low-energy'],
      base_difficulty_1_to_5: 1, base_minutes: 10,
      task_title: 'Update your lead list with today\'s status',
      why_template: 'A clear pipeline shows the next move toward {goal} at a glance.',
      steps: ['Open your lead list or CRM (a note works).', 'Update the status of each active lead.', 'Mark the single next action for the top one.', 'Screenshot the updated list (hide private details).'],
      proof_required: 'A screenshot of your lead list updated today with a next action marked.',
      allowed_proof_types: ['screenshot', 'photo'],
      proof_examples_good: ['A lead list with fresh statuses and a next step', 'A CRM board updated today'],
      proof_examples_bad: ['An empty or unchanged list', 'A list with no next action'],
      rejection_reasons: ['No update made', 'No next action marked', 'Exposes clients\' private data'] },

    // — EDGE —
    { id: 'money-cold-pitch', arena: 'money', supported_arenas: ['money'], slot: 'edge',
      time_buckets: [30, 60], energy: ['high'], blocker_tags: ['fear', 'confidence'],
      base_difficulty_1_to_5: 4, base_minutes: 30,
      task_title: 'Write and send one tailored cold pitch to a dream client',
      why_template: 'One bold, tailored pitch can change the trajectory of {goal}.',
      steps: ['Pick one dream client and research them.', 'Write a pitch tailored to their specific situation.', 'Lead with the result you\'d create.', 'Send it today.', 'Screenshot the sent pitch.'],
      proof_required: 'A screenshot of a researched, tailored cold pitch sent to a real client today.',
      allowed_proof_types: ['screenshot'],
      proof_examples_good: ['A personalised pitch in your sent folder', 'A cold email referencing the client\'s specifics'],
      proof_examples_bad: ['A generic template not sent', 'A draft with placeholders'],
      rejection_reasons: ['Pitch not sent', 'Generic, not tailored', 'No evidence of sending'] },

    { id: 'money-landing-section', arena: 'money', supported_arenas: ['money'], slot: 'edge',
      time_buckets: [30, 60], energy: ['normal', 'high'], blocker_tags: ['no-plan', 'procrastination'],
      base_difficulty_1_to_5: 4, base_minutes: 45,
      task_title: 'Build or rewrite one section of your landing page',
      why_template: 'A sharper page converts more of the traffic {goal} earns.',
      steps: ['Pick the weakest section of your page (hero, offer, proof…).', 'Rewrite or rebuild it to lead with the customer\'s result.', 'Publish or save the change.', 'Screenshot the new section.'],
      proof_required: 'A screenshot of the landing-page section you built or rewrote today.',
      allowed_proof_types: ['screenshot'],
      proof_examples_good: ['A before/after of a rewritten hero section', 'A newly built page section'],
      proof_examples_bad: ['The old page with no change', 'Notes about what to change'],
      rejection_reasons: ['No change made', 'Not visible', 'Only planned, not built'] },

    { id: 'money-price-test', arena: 'money', supported_arenas: ['money'], slot: 'edge',
      time_buckets: [15, 30], energy: ['normal', 'high'], blocker_tags: ['no-plan', 'fear'],
      base_difficulty_1_to_5: 3, base_minutes: 25,
      task_title: 'Write 2 pricing options and the reason each could work',
      why_template: 'Pricing clarity is one of the fastest levers on {goal}.',
      steps: ['Write 2 distinct pricing options for your offer.', 'For each, write who it suits and why it could work.', 'Pick the one to test next.', 'Photograph or screenshot the written options.'],
      proof_required: 'Two written pricing options each with a reason it could work.',
      allowed_proof_types: ['photo', 'screenshot'],
      proof_examples_good: ['2 price tiers with rationale written', 'A pricing comparison you wrote'],
      proof_examples_bad: ['One price with no reasoning', 'A vague note about money'],
      rejection_reasons: ['Fewer than 2 options', 'No reasoning given', 'Too vague to test'] },

    { id: 'money-publish-content', arena: 'money', supported_arenas: ['money'], slot: 'edge',
      time_buckets: [15, 30], energy: ['normal', 'high'], blocker_tags: ['fear', 'procrastination'],
      base_difficulty_1_to_5: 3, base_minutes: 20,
      task_title: 'Publish or schedule one finished piece of content',
      why_template: 'Published reps are the only ones that grow {goal}.',
      steps: ['Take one finished piece of content.', 'Publish it or schedule it.', 'Confirm it is live or queued.', 'Screenshot the published or scheduled post.'],
      proof_required: 'A screenshot of a post published or scheduled today (platform visible).',
      allowed_proof_types: ['screenshot'],
      proof_examples_good: ['A live post on your channel', 'A scheduled-upload confirmation screen'],
      proof_examples_bad: ['A draft saved on your device', 'A finished file never posted'],
      rejection_reasons: ['Not published or scheduled', 'Stays on device only', 'No platform visible'] },

    { id: 'money-customer-call', arena: 'money', supported_arenas: ['money'], slot: 'edge',
      time_buckets: [30, 60], energy: ['high'], blocker_tags: ['fear', 'confidence'],
      base_difficulty_1_to_5: 5, base_minutes: 30,
      task_title: 'Book or hold one conversation with a real customer',
      why_template: 'Real customer conversations are the fastest teacher for {goal}.',
      steps: ['Pick one real or potential customer.', 'Book a call, or hold one today.', 'Note the one thing you learned.', 'Screenshot the booking/confirmation or your written notes.'],
      proof_required: 'Evidence of a customer conversation booked or held today — a confirmation or your written takeaways.',
      allowed_proof_types: ['screenshot', 'photo'],
      proof_examples_good: ['A booked-call confirmation', 'Written notes from a conversation held today'],
      proof_examples_bad: ['A plan to "talk to customers eventually"', 'Notes with no real conversation'],
      rejection_reasons: ['No conversation booked or held', 'Only intended', 'No real customer involved'] },

    { id: 'money-system-build', arena: 'discipline', supported_arenas: ['money'], slot: 'edge',
      time_buckets: [15, 30], energy: ['normal', 'high'], blocker_tags: ['no-plan'],
      base_difficulty_1_to_5: 3, base_minutes: 25,
      task_title: 'Document one repeatable step of your business as a checklist',
      why_template: 'Systems are what let {goal} scale beyond your daily effort.',
      steps: ['Pick one task you repeat often.', 'Write it as a step-by-step checklist.', 'Note where it could be automated or delegated.', 'Screenshot the finished checklist.'],
      proof_required: 'A written step-by-step checklist for one repeatable business task.',
      allowed_proof_types: ['screenshot', 'photo'],
      proof_examples_good: ['A numbered SOP for a recurring task', 'A checklist with an automation note'],
      proof_examples_bad: ['A vague description with no steps', 'A single line'],
      rejection_reasons: ['Not a real step-by-step', 'Too vague to follow', 'No repeatable task documented'] },

    /* ───────── DISCIPLINE / FOCUS (cross-cutting cores for discipline,
       productivity, and general goals — the deep-work rep behind any goal) ───────── */
    { id: 'discipline-deep-work', arena: 'discipline', supported_arenas: ['discipline', 'study', 'money'], slot: 'core',
      time_buckets: [60], energy: ['normal', 'high'], blocker_tags: ['phone', 'procrastination'],
      base_difficulty_1_to_5: 4, base_minutes: 60,
      task_title: 'Complete one 90-minute deep-work block on your hardest task',
      why_template: 'Self-control is a muscle — one protected block trains it and moves {goal} most.',
      steps: ['Choose the one task that matters most for your goal.', 'Phone in another room, tabs closed.', 'Set a block of 60–90 minutes and work only on that.', 'Photograph the work you completed in the block.'],
      proof_required: 'The finished work from your deep-work block — a completed piece, not just a setup.',
      allowed_proof_types: ['photo', 'screenshot'],
      proof_examples_good: ['A completed report or section', 'Solved problems or a finished deliverable'],
      proof_examples_bad: ['A tidy desk with nothing finished', 'A photo of a timer with no work'],
      rejection_reasons: ['No completed work shown', 'Only a setup, nothing finished', 'Evidence of multitasking, not a block'] },

    { id: 'discipline-single-task', arena: 'discipline', supported_arenas: ['discipline', 'study', 'money'], slot: 'core',
      time_buckets: [30, 60], energy: ['normal', 'high'], blocker_tags: ['no-plan', 'procrastination'],
      base_difficulty_1_to_5: 3, base_minutes: 35,
      task_title: 'Finish one task start-to-finish with no task-switching',
      why_template: 'Single-tasking one thing to done is the rep that builds the discipline {goal} needs.',
      steps: ['Pick one task you can finish in 30–45 minutes.', 'Close everything unrelated.', 'Work it to completion without switching.', 'Photograph or screenshot the finished result.'],
      proof_required: 'One task taken fully to completion today — the finished output, not a partial.',
      allowed_proof_types: ['photo', 'screenshot'],
      proof_examples_good: ['A task marked done with its output shown', 'A finished piece of work completed in one sitting'],
      proof_examples_bad: ['A half-done task', 'A to-do list with nothing completed'],
      rejection_reasons: ['Task not actually finished', 'Only partially done', 'No output to show'] },

    { id: 'money-skill-course-rep', arena: 'money', supported_arenas: ['money'], slot: 'edge',
      time_buckets: [30, 60], energy: ['normal', 'high'], blocker_tags: ['procrastination', 'no-plan'],
      base_difficulty_1_to_5: 3, base_minutes: 35,
      task_title: 'Complete one lesson and produce the output it teaches',
      why_template: 'Learning only counts toward {goal} when it produces something real.',
      steps: ['Pick one lesson from a course or guide.', 'Complete it.', 'Immediately produce the output it teaches.', 'Screenshot or photograph the output you made.'],
      proof_required: 'The output you produced by applying the lesson today — not just notes that you watched it.',
      allowed_proof_types: ['screenshot', 'photo'],
      proof_examples_good: ['The thing the lesson taught, built by you', 'An applied exercise completed'],
      proof_examples_bad: ['A screenshot of the lesson video', 'Notes with nothing produced'],
      rejection_reasons: ['No output produced', 'Only watched the lesson', 'Output unrelated to the lesson'] }
  ];

  /* ═══════════ INDEX + LOOKUP HELPERS ═══════════ */
  var BY_ID = {};
  TEMPLATES.forEach(function (t) { BY_ID[t.id] = t; });
  function getTemplate(id) { return BY_ID[id] || null; }

  // arenas a template can serve (its scoring arena always counts as served)
  function servesArena(t, arena) {
    if (!arena) return true;
    if (t.arena === arena) return true;
    return (t.supported_arenas || []).indexOf(arena) > -1;
  }

  /* ═══════════ THE TASK CONTRACT + LINTER ═══════════
     Every directive that renders is a strict contract object. lintTask is
     the gate: a vague, unprovable, or off-goal task is rejected and replaced
     by its (non-generic) fallback. */
  var VAGUE_TASK_RE = /\b(do better|try harder|push yourself|be (more )?(productive|consistent|disciplined|focused|better|great)|work on (it|yourself|stuff|things|everything)|think about (it|your goals?|life)|(get|stay) motivated|level up|lock in|no excuses|grind|hustle|just start|make progress|believe in yourself|stay positive|do your best|keep going)\b/i;

  function minutesOf(t) {
    if (typeof t.time_estimate_minutes === 'number') return t.time_estimate_minutes;
    var s = String(t.time_estimate_minutes || t.estimated_minutes || t.meta || t.base_minutes || '');
    var nums = s.match(/\d+/g);
    return nums && nums.length ? parseInt(nums[nums.length - 1], 10) : NaN;
  }

  /* lintTask(task, context) — context: { goal, arena } (optional but recommended).
     Returns { ok, reasons[] }. Fails on the exact conditions the brief lists. */
  function lintTask(task, context) {
    context = context || {};
    var reasons = [];
    if (!task || typeof task !== 'object') return { ok: false, reasons: ['not_an_object'] };

    var title = String(task.task_title || task.title || '').trim();
    if (!title || title.length < 5) reasons.push('missing_title');
    else if (VAGUE_TASK_RE.test(title)) reasons.push('vague_title');
    else if (title.split(/\s+/).length < 3) reasons.push('title_too_short'); // verb + object + constraint

    // proof contract
    if (!String(task.proof_required || '').trim()) reasons.push('missing_proof_required');
    var rr = task.rejection_reasons;
    if (!Array.isArray(rr) || rr.length < 1 || !rr.some(function (r) { return String(r || '').trim(); })) reasons.push('missing_rejection_reasons');
    var apt = task.allowed_proof_types;
    if (!Array.isArray(apt) || apt.indexOf('photo') === -1 && apt.indexOf('screenshot') === -1) reasons.push('missing_allowed_proof_types');

    // why references the goal/arena
    var why = String(task.why_this_matters || task.why || '').trim();
    if (!why) reasons.push('missing_why');
    else {
      var goalNounStr = goalNoun(context.goal || '').toLowerCase();
      var refersGoal = goalNounStr && goalNounStr !== 'your goal' && why.toLowerCase().indexOf(goalNounStr) > -1;
      var refersArena = context.arena && why.toLowerCase().indexOf(String(context.arena).toLowerCase()) > -1;
      var hasGoalToken = /\bgoal\b|\{goal\}/i.test(why);
      if (!(refersGoal || refersArena || hasGoalToken)) reasons.push('why_not_goal_linked');
    }

    // steps: 3–5 concrete, no vague placeholders
    var steps = task.steps;
    if (!Array.isArray(steps) || steps.length < 3) reasons.push('too_few_steps');
    else {
      if (steps.length > 5) reasons.push('too_many_steps');
      if (steps.some(function (s) { s = String(s || '').trim(); return !s || s.length < 4 || VAGUE_TASK_RE.test(s) || /\bTBD\b|\bxxx\b|placeholder|\.\.\.$/i.test(s); })) reasons.push('vague_steps');
    }

    // time bounds: 5–60 for core/momentum; edge may reach 90 (caller sets 90 only when allowed)
    var mins = minutesOf(task);
    var kind = task.kind || task.slot || 'core';
    var hi = kind === 'edge' ? 90 : 60;
    if (!(mins >= 5 && mins <= hi)) reasons.push('time_out_of_bounds');

    return { ok: reasons.length === 0, reasons: reasons };
  }

  /* ═══════════ MATERIALISE — template → strict Task Contract ═══════════ */
  function fillGoal(str, goal) {
    return String(str == null ? '' : str).replace(/\{goal\}/g, goalNoun(goal));
  }
  // choose a concrete minute estimate from the template's buckets, capped by today's time
  function pickMinutes(t, todayMinutes, kind) {
    var buckets = (t.time_buckets || [t.base_minutes]).slice().sort(function (a, b) { return a - b; });
    var cap = (typeof todayMinutes === 'number') ? todayMinutes : 30;
    // momentum is always a small win regardless of capacity
    if (kind === 'momentum') return Math.min(t.base_minutes || 8, 10);
    // pick the largest bucket that fits today's time; else the smallest
    var fit = buckets.filter(function (b) { return b <= cap; });
    var bucket = fit.length ? fit[fit.length - 1] : buckets[0];
    // scale base_minutes toward the chosen bucket but keep it within edge/core bounds
    var mins = Math.round((t.base_minutes || bucket) * (bucket / (buckets[buckets.length - 1] || bucket)));
    mins = Math.max(5, Math.min(kind === 'edge' ? 90 : 60, mins || bucket));
    return mins;
  }
  function difficultyFor(t, todayEnergy, kind) {
    var d = t.base_difficulty_1_to_5 || 3;
    if (kind === 'momentum') return Math.min(d, 2);
    if (todayEnergy === 'low' && kind !== 'momentum') d = Math.max(1, d - 1);
    if (todayEnergy === 'high' && kind === 'edge') d = Math.min(5, d + 1);
    return d;
  }
  function buildFallback(t, goal) {
    // strictly smaller, still proof-based, still specific — never generic
    var steps = (t.steps || []).slice(0, Math.max(2, Math.min(3, (t.steps || []).length)));
    return {
      kind: 'fallback',
      task_title: 'Lite — ' + fillGoal(t.task_title, goal),
      why_this_matters: 'Low on time or energy? This smaller version still counts and keeps the streak on ' + goalNoun(goal) + ' alive.',
      steps: steps,
      time_estimate_minutes: Math.min(10, t.base_minutes || 8),
      difficulty_1_to_5: 1,
      proof_required: t.proof_required,
      allowed_proof_types: (t.allowed_proof_types || ['photo']).slice(),
      proof_examples_good: (t.proof_examples_good || []).slice(0, 2),
      proof_examples_bad: (t.proof_examples_bad || []).slice(0, 2),
      rejection_reasons: (t.rejection_reasons || []).slice()
    };
  }
  /* ═══════════ SMART PROOF TYPE ═══════════
     Pick the best proof modality for a task: photo · screenshot · voice · live.
       voice  → calls / outreach / sales / speaking (audio is the natural evidence)
       live   → ANY exercise or sport drill the user physically performs (reps, sets,
                drills, sprints, runs, footwork, ball work, mobility) — camera-coached
       screenshot → digital sends (messages, applications, online posts)
       photo  → produced work / study / planning / review / everything else (default)
     Honours an explicit template `recommended_proof_type` when present.
     MIRROR: supabase/functions/generate-tasks/index.ts recommendProofTypeServer —
     keep the rule ORDER and regexes token-for-token identical to that function. */
  // Canonical proof types VISION captures: exactly three. A screenshot is a MODE of
  // photo proof (an uploaded image), never a fourth user-facing type; "knowledge"/
  // "image" legacy values also fold into photo. Everything the library emits passes
  // through here so the stored/rendered recommended_proof_type is always one of three.
  function canonicalProofType(ty) {
    var v = String(ty || '').toLowerCase();
    if (v === 'live') return 'live';
    if (v === 'voice') return 'voice';
    return 'photo'; // photo | screenshot | knowledge | image | anything else → photo
  }

  function recommendProofType(t, goal) {
    var proofText = ((t && t.proof_required) || '').toLowerCase();
    var titleRaw = ((t && t.task_title) || '');
    // WEIGHTED / EQUIPMENT work is never Live: there is no licensed production
    // equipment (e.g. dumbbell) detector, so pose estimation alone cannot prove a
    // weighted task — it always falls back to Photo. This mirrors the Postgres
    // deriver (derive_personalized_proof_contract_v1) and only overrides 'live'.
    // MIRROR: supabase/functions/generate-tasks/index.ts recommendProofTypeServer.
    var equipHay = (titleRaw + ' ' + proofText).toLowerCase();
    var isEquipment = /(^|[^a-z])(dumbbell|barbell|kettlebell|weighted|goblet|bench\s*press|deadlift)([^a-z]|$)/.test(equipHay)
      || /[0-9]+\s*(kg|kgs|lb|lbs)([^a-z]|$)/.test(equipHay);
    if (t && t.recommended_proof_type) {
      var forced = canonicalProofType(t.recommended_proof_type);
      return (forced === 'live' && isEquipment) ? 'photo' : forced;
    }
    // EXPLICIT medium in the proof text wins — the generator told us the medium.
    // ("Photo of notebook page…" must never classify as live off title keywords.)
    if (/\b(on camera|live clip|live session|film yourself|record yourself doing)/.test(proofText)) return isEquipment ? 'photo' : 'live';
    if (/\b(voice note|audio recording|say (it )?out loud|talk (it )?through|recording of (you|your) (voice|call|pitch))/.test(proofText)) return 'voice';
    var title = titleRaw;
    var hay = (title + ' ' + proofText + ' ' + (goal || '')).toLowerCase();
    // PHYSICAL PERFORMANCE → live, BEFORE the photo-of / digital short-circuits below.
    // Any exercise/drill the body performs is coached live; only a pure DESK act (the
    // title starts with a log/plan/review verb, or the work is purely digital) stays photo.
    var deskAct = /^(?:log|record|write|note|plan|review|watch|track|journal|analy[sz]e|study|schedule)\b/.test(title.trim().toLowerCase())
      || /\b(screenshot|message|email|dm|post|application|submit|online|profile|upload|listing|spreadsheet|doc)\b/.test(title.toLowerCase());
    var physicalStrong = /\b(drill|reps?|sets? of|sprint|run|jog|workout|exercise|lift|gym|training session|squat|push.?up|pull.?up|sit.?up|crunch|burpee|lunge|jumping jack|plank|kettlebell|deadlift|bench press|shadow.?box|dribbl|juggl|ball control|first touch|cone|agility|footwork|form check|shoot(?:ing)?|swing|sparring|conditioning|mobility|stretch)\b/.test(hay);
    if (physicalStrong && !deskAct) return isEquipment ? 'photo' : 'live';
    // a screenshot IS photo proof (an uploaded image) — same capture surface.
    if (/\bscreenshot/.test(proofText)) return 'photo';
    if (/\b(photo|photograph|picture|image) (of|must show|showing)/.test(proofText)) return 'photo';
    // VOICE → SPEAKING actions (calls, pitches, talking to people, speaking practice).
    // Keyed on the verb, NOT the audience: "email leads" is a screenshot, "call leads"
    // is voice. Audience nouns (lead/client/customer) alone never force voice.
    // NOTE: bare "phone" is deliberately EXCLUDED — in real tasks it only ever appears
    // as a distraction noun ("phone in another room", "phone on Do Not Disturb"), never as
    // a call verb. Phone-call tasks are caught by "call"/"cold call". Keeping bare "phone"
    // here mis-routed focus/study tasks to Voice. MIRROR: recommendProofTypeServer.
    if (/\b(?:cold ?call|call(?:s|ing|ed)?\b|voice ?note|pitch|presentation|present to|speech|speak|spoken|talking to|talk to|conversation|negotiat|interview|elevator|role.?play|rehears|recite|read aloud|out loud|affirmation|podcast)/.test(hay)) return 'voice';
    // digital send (message/email/post/app log) → photo proof in screenshot mode.
    var digital = /\b(screenshot|message|email|dm|post|application|submit|online|profile|upload|sent|listing|app summary|tracker|logged|log your|spreadsheet|\bdoc\b)/.test(hay);
    if (digital) return 'photo';
    return 'photo';
  }

  function materialise(t, opts) {
    opts = opts || {};
    var goal = opts.goal || '';
    var kind = opts.kind || t.slot || 'core';
    var minutes = pickMinutes(t, opts.todayMinutes, kind);
    var diff = difficultyFor(t, opts.todayEnergy, kind);
    var factors = opts.personalization_factors_used || [];
    // smart proof type: recommend the best modality, ensure it's offerable in the set.
    // Canonicalise to the three capture surfaces (live/photo/voice) and dedupe — a
    // library entry's 'screenshot' folds into photo so no fourth type ever surfaces.
    var recProof = canonicalProofType(recommendProofType(t, goal));
    var allowedProof = (t.allowed_proof_types || ['photo']).map(canonicalProofType)
      .filter(function (v, i, a) { return a.indexOf(v) === i; });
    if (allowedProof.indexOf(recProof) === -1) allowedProof.unshift(recProof);
    var contract = {
      // ── strict contract (render reads these directly) ──
      task_id: t.id,
      kind: kind,                                   // core | momentum | edge
      task_title: fillGoal(t.task_title, goal),
      why_this_matters: fillGoal(t.why_template, goal),
      steps: (t.steps || []).slice(),
      time_estimate_minutes: minutes,
      difficulty_1_to_5: diff,
      proof_required: t.proof_required,
      allowed_proof_types: allowedProof,
      recommended_proof_type: recProof,
      proof_examples_good: (t.proof_examples_good || []).slice(0, 2),
      proof_examples_bad: (t.proof_examples_bad || []).slice(0, 2),
      rejection_reasons: (t.rejection_reasons || []).slice(),
      personalization_factors_used: factors,
      fallback_version: buildFallback(t, goal),
      // ── legacy/render bridge (existing pages + scoring pipeline read these) ──
      id: t.id,
      title: fillGoal(t.task_title, goal),
      category: kind === 'core' ? 'Core Proof' : kind === 'momentum' ? 'Momentum Proof' : 'Edge Proof',
      meta: minutes + ' min',
      difficulty: diffBucket(diff),
      baseXp: XP_BY_DIFF[diffBucket(diff)],
      arena: t.arena, goalType: t.arena,
      proof: true,
      role: kind,
      why: fillGoal(t.why_template, goal),
      whyChosen: fillGoal(t.why_template, goal),
      proofMustShow: t.proof_required,
      goodProof: (t.proof_examples_good || []).join(' · '),
      avoid: (t.rejection_reasons || [])[0] || '',
      mistake: (t.rejection_reasons || [])[0] || '',
      helps: fillGoal(t.why_template, goal),
      completed: false, proofAttached: false, note: ''
    };
    return contract;
  }

  /* ═══════════ SELECTOR ═══════════
     selectDailyDirectives(userContext, dailyConstraints, history) → [core, momentum, edge?]
       userContext     : { goal, arena, blocker, deadline, mode, streak, missedYesterday }
       dailyConstraints : { minutes (5|15|30|60), energy ('low'|'normal'|'high') }
       history          : { recentTemplateIds:[ids in last 7 days], yesterdayProofRequired:{core,momentum,edge} }
     Deterministic per (goal+arena+date). Rotates by a day-seed so plans vary
     across days. Anti-repeat: no template within 7 days; core proof_required
     not repeated two days running.  */
  function daySeed(dateStr) {
    dateStr = dateStr || new Date().toISOString().slice(0, 10);
    var s = 0; for (var i = 0; i < dateStr.length; i++) s = (s * 31 + dateStr.charCodeAt(i)) >>> 0;
    return s;
  }
  function scoreCandidate(t, ctx, con, kind, recentIds, yesterdayProof) {
    var score = 0;
    var blocker = normalizeBlocker(ctx.blocker);
    if (servesArena(t, ctx.arena)) score += 40;
    if ((t.blocker_tags || []).indexOf(blocker) > -1) score += 22;
    if ((t.energy || []).indexOf(con.energy) > -1) score += 14; else score -= 18;
    if ((t.time_buckets || []).indexOf(con.minutes) > -1) score += 12;
    else if ((t.time_buckets || []).some(function (b) { return b <= con.minutes; })) score += 4;
    else score -= 14; // template needs more time than the user has
    // streak: nudge core/edge difficulty up for a hot streak, down on a comeback
    if (kind !== 'momentum') {
      if ((ctx.streak || 0) >= 5) score += (t.base_difficulty_1_to_5 || 3) * 2;
      if (ctx.missedYesterday) score -= (t.base_difficulty_1_to_5 || 3) * 3;
    }
    // anti-repeat: penalise reuse within the 7-day window, recency-weighted so
    // that when the pool is exhausted the LEAST-recently-used template wins
    // (recentIds is chronological, oldest first → higher index = more recent).
    if (recentIds && recentIds.length) {
      var ri = recentIds.lastIndexOf(t.id);
      // base 100 guarantees any FRESH template outranks any reused one; +ri then
      // makes the least-recently-used the best choice once the pool is exhausted.
      if (ri > -1) score -= 100 + ri;
    }
    // anti-repeat: don't repeat the same core proof requirement two days running
    if (yesterdayProof && yesterdayProof[kind] && yesterdayProof[kind] === t.proof_required) score -= 30;
    return score;
  }
  function pickForSlot(kind, ctx, con, recentIds, yesterdayProof, excludeIds, seed) {
    var pool = TEMPLATES.filter(function (t) {
      return t.slot === kind && servesArena(t, ctx.arena) && excludeIds.indexOf(t.id) === -1;
    });
    // fall back to any-arena templates of this slot if the arena pool is empty
    if (!pool.length) pool = TEMPLATES.filter(function (t) { return t.slot === kind && excludeIds.indexOf(t.id) === -1; });
    if (!pool.length) return null;
    var ranked = pool.map(function (t) {
      return { t: t, s: scoreCandidate(t, ctx, con, kind, recentIds, yesterdayProof) };
    }).sort(function (a, b) { return b.s - a.s || (a.t.id < b.t.id ? -1 : 1); });
    // among the top tier (within 8 pts of best), rotate by day-seed so plans vary
    var best = ranked[0].s;
    var top = ranked.filter(function (r) { return best - r.s <= 8; });
    return top[seed % top.length].t;
  }
  function whichFactors(ctx, con) {
    var f = [];
    var g = goalNoun(ctx.goal || '');
    if (g && g !== 'your goal') f.push('goal');
    if (ctx.arena) f.push('arena');
    if (con && typeof con.minutes === 'number') f.push('time_today');
    if (con && con.energy) f.push('energy_today');
    if (ctx.blocker) f.push('blocker');
    if ((ctx.streak || 0) > 0 || ctx.missedYesterday) f.push('streak_state');
    return f;
  }
  function selectDailyDirectives(userContext, dailyConstraints, history) {
    var ctx = userContext || {};
    var con = Object.assign({ minutes: 15, energy: 'normal' }, dailyConstraints || {});
    if (TIME_BUCKETS.indexOf(con.minutes) === -1) con.minutes = 15;
    if (ENERGY.indexOf(con.energy) === -1) con.energy = 'normal';
    var hist = history || {};
    var recentIds = hist.recentTemplateIds || [];
    var yesterdayProof = hist.yesterdayProofRequired || {};
    var seed = daySeed(hist.date);
    var factors = whichFactors(ctx, con);

    var chosen = [];
    var exclude = [];

    // 1) CORE — always present
    var coreT = pickForSlot('core', ctx, con, recentIds, yesterdayProof, exclude, seed);
    if (coreT) { exclude.push(coreT.id); chosen.push(materialise(coreT, { goal: ctx.goal, kind: 'core', todayMinutes: con.minutes, todayEnergy: con.energy, personalization_factors_used: factors })); }

    // 2) MOMENTUM — the minimum-viable win (5–10 min); always present
    var momT = pickForSlot('momentum', ctx, con, recentIds, yesterdayProof, exclude, seed + 1);
    if (momT) { exclude.push(momT.id); chosen.push(materialise(momT, { goal: ctx.goal, kind: 'momentum', todayMinutes: con.minutes, todayEnergy: con.energy, personalization_factors_used: factors })); }

    // 3) EDGE — skill-builder, only when there's capacity (time ≥ 30 OR energy ≠ low)
    if (con.minutes >= 30 || con.energy !== 'low') {
      var edgeT = pickForSlot('edge', ctx, con, recentIds, yesterdayProof, exclude, seed + 2);
      if (edgeT) {
        var edgeOpts = { goal: ctx.goal, kind: 'edge', todayMinutes: con.minutes, todayEnergy: con.energy, personalization_factors_used: factors };
        // edge may stretch to 90 only when the user chose 60+ and energy is high
        if (con.minutes >= 60 && con.energy === 'high') edgeOpts.todayMinutes = Math.max(60, con.minutes);
        chosen.push(materialise(edgeT, edgeOpts));
      }
    }

    // FINAL GATE: every directive must pass lint, else swap to its fallback (still specific)
    var lintCtx = { goal: ctx.goal, arena: ctx.arena };
    chosen = chosen.map(function (d) {
      var res = lintTask(d, lintCtx);
      if (res.ok) return d;
      try { if (V.analytics) V.analytics.track('task_linter_fallback', { reason: res.reasons[0] }); } catch (e) {}
      var fb = d.fallback_version || {};
      // promote the fallback into a full contract that keeps the original proof contract
      var promoted = Object.assign({}, d, {
        task_title: fb.task_title || d.task_title, title: fb.task_title || d.title,
        steps: (fb.steps && fb.steps.length >= 3) ? fb.steps : d.steps.slice(0, 3),
        time_estimate_minutes: fb.time_estimate_minutes || 8, meta: (fb.time_estimate_minutes || 8) + ' min',
        difficulty_1_to_5: 1, difficulty: 'easy', baseXp: XP_BY_DIFF.easy
      });
      // if even the fallback can't pass (e.g. <3 steps), keep original steps to satisfy the linter
      if (!lintTask(promoted, lintCtx).ok) promoted.steps = d.steps.slice(0, Math.max(3, Math.min(5, d.steps.length)));
      return promoted;
    });

    return chosen;
  }

  /* ═══════════ PUBLIC API ═══════════ */
  V.tasks = {
    TEMPLATES: TEMPLATES,
    SLOTS: SLOTS, TIME_BUCKETS: TIME_BUCKETS, ENERGY: ENERGY,
    getTemplate: getTemplate,
    goalNoun: goalNoun, normalizeBlocker: normalizeBlocker,
    lintTask: lintTask,
    materialise: materialise,
    recommendProofType: recommendProofType,
    canonicalProofType: canonicalProofType,
    selectDailyDirectives: selectDailyDirectives,
    // counts for QA/inspection
    stats: function () {
      var byArena = {}, bySlot = {};
      TEMPLATES.forEach(function (t) { byArena[t.arena] = (byArena[t.arena] || 0) + 1; bySlot[t.slot] = (bySlot[t.slot] || 0) + 1; });
      return { total: TEMPLATES.length, byArena: byArena, bySlot: bySlot };
    }
  };

  // Node/test interop (no effect in the browser)
  if (typeof module !== 'undefined' && module.exports) { module.exports = V.tasks; }
})(window.VISION);
