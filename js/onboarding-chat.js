/* ═══════════════════════════════════════════════════════════════
   onboarding-chat.js — VISION "Build Your Proof System" chat engine v3
   ---------------------------------------------------------------
   Universal Goal Reasoning Engine for 1,000+ real human goals.
   21-category taxonomy · 28+ sport subtypes · per-role skill chips.

   Cricket → "What type of cricket player are you building into?"
   with chips: Batsman / Fast bowler / Spin bowler / All-rounder / Wicketkeeper.

   Pure logic — no DOM, no network. Unit-testable headless.

   Public API: window.VISION.onboardingChat
     classifyGoalLocal(goalText) → classification
     narrowNode()                → category-picker node for vague goals
     treeFor(classification)     → ordered [ node, … ] of questions
     buildProofProfile(answers, classification) → flat structured profile
     summarise(profile)          → one-line onboarding summary
═══════════════════════════════════════════════════════════════ */
window.VISION = window.VISION || {};

(function (V) {
  'use strict';

  function clean(s) { return String(s == null ? '' : s).toLowerCase().trim(); }
  function cap(s) { s = String(s || ''); return s.charAt(0).toUpperCase() + s.slice(1); }
  function wordCount(s) { return clean(s).split(/\s+/).filter(Boolean).length; }

  /* ═══════════ SAFETY ═══════════ */
  var UNSAFE = [
    { re: /anorexi|bulimi|starv|skip(ping)? meals|not eat(ing)?\s*(at all|anything|today)|stop eating\s*(completely|altogether|at all|everything|nothing)|lose \d{2,}\s*(kg|lbs|pounds)\s*(fast|in a week|this week)|extreme (diet|weight loss|cut)|0 ?cal|laxative/,
      msg: 'VISION builds healthy routines, not anything that harms you. Let\'s aim at strength, energy and consistency instead.',
      to: 'fitness' },
    { re: /self[- ]?harm|suicide|kill myself|end (it|my life)|hurt myself/,
      msg: 'I can\'t help with that, and you deserve real support - please talk to someone you trust or a local helpline. VISION can help you build a small, safe daily routine when you\'re ready.',
      to: 'wellbeing' },
    { re: /steroid|sarm|illegal|drug deal|sell drugs|weapon|hack (into|someone)|scam|launder|revenge|hurt (someone|him|her|them)/,
      msg: 'VISION can only build safe, legal proof systems. Pick a safer direction and we\'ll map it.',
      to: 'custom' }
  ];
  function safetyCheck(t) {
    for (var i = 0; i < UNSAFE.length; i++) { if (UNSAFE[i].re.test(t)) return UNSAFE[i]; }
    return null;
  }

  /* ═══════════ 21-CATEGORY MATCHERS ═══════════ */
  var CATEGORY_MATCHERS = [
    ['screen_time',   /screen[\s-]?time|less screen|too much (phone|screen)|phone addict|stop scrolling|doom.?scroll|off my phone|social media addict|less phone|spend.*time on.*(phone|social)|addicted to (my )?phone|too much.*social media|less time on.*(phone|social)/],
    ['sleep_routine', /sleep earlier|wake up earlier|morning routine|night routine|go to bed (earlier|by)|bedtime|sleep schedule|fix my sleep|better sleep|wake up at \d|sleep at \d|go to sleep|sleep by \d|stay(ing)? up late|stop staying up/],
    ['discipline',    /more disciplin|\bdisciplined?\b|stop procrastinat|stop being lazy|stop wasting time|beat procrastination|focus more|be more productive|self.disciplin|be consistent\b|get my life together|stop getting distracted|lock in\b|locked in\b/],
    ['confidence',    /\bconfidence\b|social confidence|talk to (girls|guys|people|strangers)|more confident|social skills|stop being shy|speak up more|overcome shyness|approach (people|girls|guys)|be more outgoing|outgoing\b|social anxiety|public speaking|social events?|be confident in|become confident|\bconfident\b|make (more )?friends|better in conversations?|network better/],
    ['health_habit',  /drink more water|eat healthier|better diet|\bnutrition\b|lose weight and keep it|hydrat|meal prep|stop eating junk|healthy habits|no more junk food|better eating|eat better|calorie|macros|eat less junk|less junk food/],
    ['exam',          /\batar\b|\bsat\b|\bact\b|\bucat\b|\bgmat\b|\bgre\b|\bielts\b|\btoefl\b|\bbar exam\b|medical boards?|nclex|\bcpa exam\b|driving test|theory test|get my licen|driving licen/],
    ['soccer',        /soccer|football(?!\s*(american|manager))|striker|winger|midfield|goalkeep|goalie|defender|footballer/],
    ['sport',         /cricket|batsman|\bbowl(er)?\b|wicket|all.rounder|basketball|tennis|boxing|\bboxer\b|\bmma\b|muay.thai|kickbox|swim|sprint|track and field|athletics|hockey|volleyball|baseball|golf|netball|\bafl\b|\bnrl\b|rugby|cycling|cyclist|badminton|squash|table.tennis|ping.pong|archery|sailing|equestrian|sport\b|leg spin|yorker/],
    ['medicine',      /doctor|medicine|medical|surgeon|\bnurse\b|\bgp\b|paediatric|pediatric|physician|cardiolog|dentist|vet(erinar)?|pharmacist|optometrist|physio(therapist)?|paramedic|midwife|general practitioner|practitioner|neurolog|radiolog|obstetri|psychiatr|anaesthet|geriatri|rheumatolog/],
    ['trade',         /electrician|plumb(er|ing)|carpenter|carpentry|weld(er|ing)|builder|bricklayer|plasterer|tiler|roofer|boilermaker|concreter|gas.fitter|trade.apprentice|get.my.trade|\bmechanic\b/],
    ['content',       /youtube|tiktok|instagram|\bchannel\b|podcast|content creat|\bvlog|streamer|twitch|influencer|followers|subscribers|\breels?\b|post.*social media|build.*tiktok|grow.*(instagram|tiktok)/],
    ['business',      /\bbusiness(?!\s+studies)|startup|start[\s-]?up|agency|\bclient|freelanc|\bsaas\b|ecommerce|e-commerce|\bstore\b|\bbrand\b|entrepreneur|side hustle|dropship|cleaning business|sell (online|products|a service)|launch (a|my)|get clients|build an? app|\bai app\b|ai automation|automation workflow|sales call/],
    ['gaming',        /\bgaming\b|esports?|pro gamer|roblox|minecraft|valorant|fortnite|cs.?go|league of legends|overwatch|apex legends|rocket league|warzone/],
    ['career',        /lawyer|barrister|solicitor|engineer|teacher|accountant|architect|get a job|land a job|\bcareer\b|promotion|interview|resume|\bcv\b|recruit|journalist|police officer|firefighter|army|navy|air force|\bdeveloper\b|programmer|\bcoder\b|\bdesigner\b/],
    ['creative',      /write a book|novel|\bart\b|draw|paint|music|produce (beats|music)|\bdesign\b|illustrat|photograph|\bfilms?\b|animat|songs?\b|\bsing(ing)?\b|actor|singer|rapper?|\bfamous\b/],
    ['fitness',       /\bfit(ter|ness)?\b|\bgym\b|muscle|physique|\babs\b|lose (weight|fat|\d+(kg|lb))|weight loss|strength|lean|\btoned?\b|bulk|shred|work(ing)? out|workout|exercise|push[\s-]?ups?|pull.ups?|home workout|calisthenics|bodybuilding|stamina|endurance|cardio|running|marathon|triathlon|\b\d+\s?km\b|\b(5|10)k\s*(run|race|parkrun|marathon)\b|run.{0,12}\b(5|10)k\b|stronger\b|six.?pack|flexibility|vertical jump|better body|train at home|run faster/],
    ['study',         /maths?|english\b|study|pdhpe|business studies|grade|\bgpa\b|\batar\b|school|college|university|degree|revision|homework|biology|chemistry|physics|science|essay|coursework|legal studies|history\b|geography|economics\b/],
    ['money',         /\bsave\b|saving|\$\s?\d|\d+\s*(k\b|dollars|bucks)|\bmoney\b|budget|\bdebt\b|income|\bearn|salary|wealth|\brich\b|\binvest|trading|\btrade\b|crypto|stocks|side income|passive income|financ|emergency fund|overspend|spending|paycheck|financial freedom/],
    ['number_target', /\bread \d{1,3} books?\b|hit \d+,?0{3} steps?\b|train \d+ days? (a|per) week|apply for \d+ jobs?\b|message \d+ (leads?|people|clients?)|get \d+,?000 (followers?|subscribers?)|\bdo \d{2,} (pushups?|pull.?ups?|squats?|situps?)\b/],
    ['language',      /\b(japanese|punjabi|hindi|spanish|french|arabic|chinese|korean|german|italian|russian|portuguese|turkish|swahili|mandarin|cantonese|vietnamese|thai|greek|hebrew|dutch|polish|swedish)\b|learn.*(language|tongue)|speak.*(fluent|conversational)/],
    ['leadership',    /\bleader(ship)?\b|better leader|lead (a|my) (team|people|group)|\bmanager\b|manage (a|my) team|team lead|become a boss|run a team|captaincy|be a captain/],
    ['lifestyle',     /\bsuccessful\b|change my life|improve myself|better myself|level up my life|level up\b|my potential|reach my potential|be the best version|best version of (myself|me)|better future|better person\b|improve (as a person|my life)|become more\b|be him\b|be like him|get better\b(?!\s+at)/]
  ];

  /* ═══════════ DOMAIN-TYPE DETECTION ═══════════ */
  var DOMAIN_TYPE_PATTERNS = [
    ['language',       /\b(japanese|spanish|french|mandarin|chinese|korean|arabic|portuguese|german|italian|russian|hindi|turkish|dutch|polish|swedish|norwegian|danish|greek|hebrew|farsi|thai|vietnamese|swahili|latin|punjabi|cantonese)\b|learn (a |the )?\w+ language|speak \w+ish|speak \w+ese|speak \w+ian|become fluent in|conversational in/],
    ['flight',         /\b(pilot|aviation|flying|instrument rating|ppl\b|cpl\b|atpl|ifr\b|vfr\b|drone pilot|paraglid|glid(ing|er)|helicopter|rotary)\b/],
    ['chess_strategy', /\b(chess|poker strategy|bridge game|shogi|go game)\b/],
    ['instrument',     /\b(piano|guitar|violin|drums?|drumming|bass guitar|trumpet|saxophone|flute|ukulele|cello|harp|trombone|clarinet|banjo|harmonica|keyboard)\b|music theory|sight[\s-]?read|play (a |the |an )?\w+ instrument/],
    ['coding',         /\b(python|javascript|typescript|react|vue|angular|node\.?js|rust\b|swift\b|kotlin|machine learning|deep learning|data science|neural|sql\b|game\s*(dev|development|making)|3d\s*(model|modelling|printing)|cybersecurity|software engineer|software development|learn to code|roblox|ai app)\b|(build|make|code)\s+(a\s+)?game|blender|unity|unreal engine/],
    ['cooking',        /\bchef\b|cooking|bak(e|ing|er|ery|ehouse)|pastry|culinary|cuisine|\brecipe\b|\bbarista\b|mixolog|cocktail|\bbbq\b|grilling|sourdough|bread.mak|cake.decorat|food.plating|ferment/],
    ['technical_skill',/\b(mechanic|electrician|plumbing|plumber|welding|welder|carpent|woodworking|woodwork|sewing|tailoring|knitting|leatherwork|ceramics|pottery|glasswork|watchmaking|jewellery?|jeweler|blacksmith|metalwork|origami|calligraph|macrame|embroidery?|crochet|papercraf)\b|fix (cars?|bikes?|engines?)|car maintenance/],
    ['physical_skill', /\b(yoga|dancing|dance\b|gymnastics|parkour|judo|karate|taekwondo|muay thai|kickboxing|wrestling|archery|rock climbing|skiing|snowboarding|skateboarding|surfing|scuba|diving|kayaking|horse riding|equestrian|capoeira|pole dance|ballet|circus|acrobat)\b/],
    ['performance',    /\b(stand[\s-]?up comedy|public speaking|giving speeches|speech delivery|debating|improv comedy|magic tricks?|juggling|sleight of hand|stage presence|slam poetry|rap battle|storytelling)\b/],
    ['knowledge',      /\b(chess theory|history\b|philosophy|economics|psychology|astronomy|geography|law\b|accounting|personal finance|stock market|investing)\b/]
  ];

  function getDomainType(t) {
    for (var i = 0; i < DOMAIN_TYPE_PATTERNS.length; i++) {
      if (DOMAIN_TYPE_PATTERNS[i][1].test(t)) return DOMAIN_TYPE_PATTERNS[i][0];
    }
    return 'general';
  }

  function extractDomainNoun(goalText) {
    var t = String(goalText || '').trim();
    var stripped = t
      .replace(/^i (want to|wanna|need to|would like to|am trying to|hope to|plan to|aim to)\s+/i, '')
      .replace(/^(become|be\s+a|get|learn|master|improve (at |my )?|get better at|start|practice|study|do|try|work on|build)\s+/i, '')
      .replace(/\b(a|an|the|more|better|good|great|best|pro|professional|expert|advanced|beginner|skilled|strong)\b/gi, '')
      .replace(/\s+/g, ' ').trim();
    var words = stripped.split(/\s+/).filter(function (w) {
      return w.length > 2 && !/^(and|the|with|for|from|that|this|than|into|over|about|some|just|really|very|my|me|how)$/.test(w.toLowerCase());
    });
    return words.slice(0, 3).join(' ') || t.slice(0, 40).trim();
  }

  /* ═══════════ SPORT DETECTION TABLES ═══════════ */

  var SPORT_SUBTYPES_DETECT = [
    [/cricket|batsman|bowler|\bbowl\b|wicket.?keeper|all.rounder|spinner|fast bowler|spin bowler|leg spin|yorker/, 'cricket'],
    [/basketball|point guard|shooting guard|\bnba\b/, 'basketball'],
    [/\btennis\b|forehand|backhand|serve.and.volley/, 'tennis'],
    [/\bboxing\b|boxer\b/, 'boxing'],
    [/\bmma\b|mixed martial|ufc\b/, 'MMA'],
    [/muay thai/, 'muay thai'],
    [/kickbox/, 'kickboxing'],
    [/\bswim|freestyle stroke|backstroke|breaststroke|butterfly stroke/, 'swimming'],
    [/\bgolf\b|golfer|putting|chipping|tee.shot/, 'golf'],
    [/netball/, 'netball'],
    [/\bafl\b|aussie rules|australian rules/, 'AFL'],
    [/\bnrl\b|rugby league/, 'NRL'],
    [/rugby union/, 'rugby union'],
    [/\brugby\b(?!.*league)/, 'rugby'],
    [/volleyball/, 'volleyball'],
    [/\bhockey\b/, 'hockey'],
    [/baseball|softball/, 'baseball'],
    [/\bcycling|\bcyclist/, 'cycling'],
    [/gymnastics/, 'gymnastics'],
    [/badminton/, 'badminton'],
    [/\bsquash\b/, 'squash'],
    [/table tennis|ping.pong/, 'table tennis'],
    [/archery/, 'archery'],
    [/\bsailing|sail\b/, 'sailing'],
    [/equestrian|horse riding/, 'equestrian'],
    [/marathon|5k|10k|half marathon|\brun\b|sprinter|sprint\b/, 'running'],
    [/track (and field|athlete)|athletics/, 'running']
  ];

  var SPORT_ROLE_DETECT = {
    cricket: [
      [/\bbatsman\b|\bbatter\b|opening bat/, 'batsman'],
      [/fast bowler|pace bowler|seam bowler/, 'bowler'],
      [/spin bowler|spinner|leg spin|off spin/, 'spin-bowler'],
      [/all.rounder/, 'all-rounder'],
      [/wicket.?keeper|keeper\b/, 'wicketkeeper']
    ],
    basketball: [
      [/point guard|\bpg\b/, 'point-guard'],
      [/shooting guard|\bsg\b/, 'shooting-guard'],
      [/small forward|\bsf\b/, 'small-forward'],
      [/power forward|\bpf\b/, 'power-forward'],
      [/\bcenter\b|\bcentre\b/, 'center']
    ],
    running: [
      [/sprint|100m|200m|400m/, 'sprint'],
      [/800m|1500m|middle distance/, 'middle'],
      [/marathon|10k|long distance|half marathon/, 'long']
    ],
    golf: [
      [/driving|\bdriver\b/, 'driving'],
      [/\birons?\b/, 'irons'],
      [/short game|chipping?|pitching?/, 'short-game'],
      [/putting|\bputter\b/, 'putting']
    ],
    swimming: [
      [/freestyle/, 'freestyle'],
      [/backstroke/, 'backstroke'],
      [/breaststroke/, 'breaststroke'],
      [/butterfly/, 'butterfly']
    ]
  };

  var SPORT_ROLE_CHIPS = {
    cricket:    [['Batsman', 'batsman'], ['Fast bowler', 'bowler'], ['Spin bowler', 'spin-bowler'], ['All-rounder', 'all-rounder'], ['Wicketkeeper', 'wicketkeeper'], ['Not sure yet', 'unsure']],
    basketball: [['Point guard', 'point-guard'], ['Shooting guard', 'shooting-guard'], ['Small forward', 'small-forward'], ['Power forward', 'power-forward'], ['Center', 'center'], ['Not sure', 'unsure']],
    tennis:     [['Aggressive baseliner', 'baseliner'], ['Serve & volley', 'serve-volley'], ['All-court', 'all-court']],
    boxing:     [['Orthodox', 'orthodox'], ['Southpaw', 'southpaw']],
    MMA:        [['Striker', 'striker'], ['Grappler', 'grappler'], ['All-round', 'all-round']],
    swimming:   [['Freestyle', 'freestyle'], ['Backstroke', 'backstroke'], ['Breaststroke', 'breaststroke'], ['Butterfly', 'butterfly'], ['All strokes / IM', 'all']],
    golf:       [['Full game', 'all-round'], ['Driving', 'driving'], ['Iron play', 'irons'], ['Short game', 'short-game'], ['Putting', 'putting']],
    netball:    [['Shooter (GA / GS)', 'shooter'], ['Mid-court (C / WA / WD)', 'mid-court'], ['Defence (GD / GK)', 'defence']],
    AFL:        [['Forward', 'forward'], ['Midfield', 'midfield'], ['Defence', 'defence'], ['Ruck', 'ruck']],
    NRL:        [['Backs', 'backs'], ['Forwards', 'forwards'], ['Halves / halfback', 'halves']],
    volleyball: [['Setter', 'setter'], ['Outside hitter', 'outside'], ['Libero', 'libero'], ['Middle blocker', 'middle']],
    hockey:     [['Striker / forward', 'striker'], ['Midfielder', 'midfielder'], ['Defender', 'defender'], ['Goalkeeper', 'goalkeeper']],
    running:    [['Sprinter (100–400 m)', 'sprint'], ['Middle distance (800–1500 m)', 'middle'], ['Long distance / marathon', 'long']],
    cycling:    [['Road racing', 'road'], ['Mountain bike', 'mtb'], ['Track', 'track'], ['Time trial', 'tt']]
  };

  var SPORT_SKILL_CHIPS = {
    cricket: {
      batsman:       [['Front-foot shots', 'front-foot'], ['Back-foot play', 'back-foot'], ['Running between wickets', 'running-btwkt'], ['Sweep / pull shot', 'sweep-pull'], ['Defensive technique', 'defence']],
      bowler:        [['Line and length', 'line-length'], ['Swing / seam movement', 'swing-seam'], ['Variations', 'variations'], ['Yorker delivery', 'yorker'], ['Fitness & run-up', 'fitness']],
      'spin-bowler': [['Flight and loop', 'flight'], ['Turn and grip', 'turn-grip'], ['Variation / googly', 'variations'], ['Economy rate', 'economy']],
      'all-rounder': [['Batting technique', 'batting'], ['Bowling action', 'bowling'], ['Fielding', 'fielding'], ['Fitness', 'fitness']],
      wicketkeeper:  [['Glove work', 'gloves'], ['Footwork', 'footwork'], ['Stumpings', 'stumpings'], ['Reading spin', 'reading-spin']],
      unsure:        [['Batting', 'batting'], ['Bowling', 'bowling'], ['Fielding', 'fielding'], ['Fitness', 'fitness']],
      _default:      [['Batting', 'batting'], ['Bowling', 'bowling'], ['Fielding', 'fielding'], ['Fitness', 'fitness']]
    },
    basketball: {
      'point-guard':    [['Ball handling', 'handles'], ['Passing / court vision', 'passing'], ['Pull-up jumper', 'pull-up'], ['Pick & roll reads', 'pick-roll']],
      'shooting-guard': [['Catch-and-shoot', 'catch-shoot'], ['Off-ball movement', 'movement'], ['Dribble pull-up', 'dribble-pull'], ['Defence', 'defence']],
      'small-forward':  [['Mid-range shooting', 'mid-range'], ['Driving to rim', 'driving'], ['Rebounding', 'rebounding'], ['Perimeter defence', 'defence']],
      'power-forward':  [['Post-up moves', 'post'], ['Rebounding', 'rebounding'], ['Mid-range game', 'mid-range'], ['Screen setting', 'screens']],
      center:           [['Post moves', 'post'], ['Rebounding', 'rebounding'], ['Footwork', 'footwork'], ['Rim protection', 'rim-protection']],
      _default:         [['Shooting', 'shooting'], ['Ball handling', 'handles'], ['Defence', 'defence'], ['Fitness', 'fitness']]
    },
    running: {
      sprint:   [['Start / reaction time', 'start'], ['Drive phase / acceleration', 'acceleration'], ['Max velocity technique', 'max-speed'], ['Explosive power', 'power']],
      middle:   [['Pace judgement', 'pacing'], ['Kick / finishing speed', 'kick'], ['VO2 max', 'vo2'], ['Tactical racing', 'tactics']],
      long:     [['Pacing strategy', 'pacing'], ['Aerobic base / endurance', 'endurance'], ['Nutrition / hydration', 'nutrition'], ['Consistency', 'consistency']],
      _default: [['Pace', 'pace'], ['Endurance', 'endurance'], ['Running technique', 'technique'], ['Consistency', 'consistency']]
    },
    golf: {
      driving:      [['Stance & alignment', 'alignment'], ['Swing plane', 'swing-plane'], ['Distance', 'distance'], ['Accuracy off tee', 'accuracy']],
      irons:        [['Ball striking', 'ball-striking'], ['Distance control', 'distance-control'], ['Shot shaping', 'shot-shape']],
      'short-game': [['Chipping', 'chipping'], ['Pitching', 'pitching'], ['Bunker play', 'bunker'], ['Lob shots', 'lob']],
      putting:      [['Reading greens', 'reading'], ['Distance control', 'distance-control'], ['Short putts', 'short-putts'], ['Pre-putt routine', 'routine']],
      'all-round':  [['Driving accuracy', 'driving'], ['Iron play', 'irons'], ['Short game', 'short-game'], ['Putting', 'putting'], ['Course management', 'course-mgmt']],
      _default:     [['Driving', 'driving'], ['Iron play', 'irons'], ['Short game', 'short-game'], ['Putting', 'putting']]
    },
    swimming: {
      freestyle:    [['Stroke technique', 'stroke'], ['Flip turns', 'turns'], ['Breathing pattern', 'breathing'], ['Kick', 'kick']],
      backstroke:   [['Stroke rate', 'stroke-rate'], ['Turns', 'turns'], ['Body rotation', 'rotation']],
      breaststroke: [['Pull / kick timing', 'pull-kick'], ['Streamline', 'streamline'], ['Turn speed', 'turns']],
      butterfly:    [['Undulation / dolphin kick', 'dolphin-kick'], ['Pull pattern', 'pull'], ['Breathing', 'breathing']],
      _default:     [['Stroke technique', 'stroke'], ['Turns & starts', 'turns'], ['Endurance', 'endurance'], ['Speed', 'speed']]
    },
    netball: {
      shooter:     [['Shooting accuracy', 'accuracy'], ['Footwork in circle', 'footwork'], ['Positioning', 'positioning']],
      'mid-court': [['Centre pass', 'centre-pass'], ['Speed & agility', 'agility'], ['Decision making', 'decision-making']],
      defence:     [['Intercepting', 'intercept'], ['Pressure on shooter', 'pressure'], ['Footwork', 'footwork']],
      _default:    [['Footwork', 'footwork'], ['Positioning', 'positioning'], ['Fitness', 'fitness'], ['Decision making', 'decision-making']]
    },
    AFL: {
      forward:  [['Marking', 'marking'], ['Goal kicking', 'kicking'], ['Lead timing', 'leads'], ['Contested work', 'contested']],
      midfield: [['Clearances', 'clearances'], ['Contested ball', 'contested'], ['Stamina', 'stamina'], ['Disposal', 'disposal']],
      defence:  [['Intercept marking', 'intercept'], ['Spoiling', 'spoil'], ['One-on-one defence', '1v1'], ['Rebound', 'rebound']],
      ruck:     [['Hitout technique', 'hitout'], ['Contest positioning', 'positioning'], ['Ground ball', 'ground-ball'], ['Fitness', 'fitness']],
      _default: [['Kicking', 'kicking'], ['Marking', 'marking'], ['Fitness / stamina', 'fitness'], ['Decision making', 'decision-making']]
    },
    volleyball: {
      setter:   [['Setting accuracy', 'setting'], ['Court reading', 'reading'], ['Tempo variation', 'tempo']],
      outside:  [['Spike approach', 'spike'], ['Serve reception', 'reception'], ['Serving', 'serve']],
      libero:   [['Digging', 'dig'], ['Serve reception', 'reception'], ['Passing accuracy', 'passing']],
      middle:   [['Quick attacks', 'quick-attack'], ['Blocking', 'blocking'], ['Transition', 'transition']],
      _default: [['Spiking / attacking', 'spike'], ['Serving', 'serve'], ['Defence / digging', 'dig'], ['Blocking', 'blocking']]
    },
    _default: [['Technique', 'technique'], ['Fitness', 'fitness'], ['Consistency', 'consistency'], ['Strategy / game IQ', 'strategy']]
  };

  function sportSkillChips(sport, role) {
    var sportMap = sport ? SPORT_SKILL_CHIPS[sport] : null;
    if (!sportMap) return SPORT_SKILL_CHIPS._default;
    var chips = (role && sportMap[role]) ? sportMap[role] : sportMap._default;
    return chips || SPORT_SKILL_CHIPS._default;
  }

  /* ═══════════ SUBTYPE / ROLE DETECTION ═══════════ */
  var SOCCER_POSITIONS = [
    [/goalkeep|goalie|keeper/, 'goalkeeper'], [/winger|wing\b|wide/, 'winger'],
    [/striker|forward|number 9|finish/, 'striker'], [/midfield|cam\b|cdm\b|playmaker/, 'midfielder'],
    [/defender|centre[\s-]?back|center[\s-]?back|full[\s-]?back|cb\b|defence|defense/, 'defender']
  ];
  var SUBTYPES = {
    soccer:   SOCCER_POSITIONS,
    medicine: [[/surgeon|surgery/, 'surgeon'], [/emergency|\ber\b|\bed\b/, 'emergency doctor'], [/paediatric|pediatric|child/, 'paediatrician'], [/sports? (doctor|medicine)/, 'sports doctor'], [/dentist/, 'dentist'], [/\bgp\b|family doctor|general prac/, 'GP'], [/nurse/, 'nurse']],
    business: [[/app|saas|software/, 'app/SaaS'], [/ecommerce|e-commerce|store|dropship/, 'ecommerce'], [/agency|service|cleaning|freelanc/, 'service business'], [/content|media/, 'content business'], [/local|shop|cafe|restaurant/, 'local business'], [/invest|saving|stocks/, 'investing']],
    career:   [[/lawyer|law/, 'lawyer'], [/engineer/, 'engineer'], [/teacher/, 'teacher'], [/developer|programmer|software/, 'developer'], [/designer/, 'designer'], [/accountant|finance/, 'accountant']],
    content:  [[/youtube/, 'YouTube'], [/tiktok/, 'TikTok'], [/instagram|reels/, 'Instagram'], [/podcast/, 'podcast'], [/twitch|streamer/, 'streaming']],
    creative: [[/book|novel|writing|author/, 'writer'], [/music|beats|sing|rap/, 'musician'], [/draw|paint|art|illustrat/, 'artist'], [/photograph/, 'photographer'], [/film|animation|video/, 'filmmaker'], [/actor|acting/, 'actor']],
    fitness:  [[/lose (weight|fat)|weight loss|leaner?|toned?/, 'fat loss'], [/muscle|bulk|strength|stronger/, 'strength'], [/run|marathon|stamina|cardio|endurance/, 'endurance'], [/sport|performance/, 'performance']],
    study:    [[/maths?/, 'maths'], [/biology|chem|physics|science/, 'science'], [/english|essay|writing/, 'english'], [/exam|atar|gpa|test/, 'exam prep']],
    trade:    [[/electrician/, 'electrician'], [/plumb/, 'plumber'], [/carpent|carpenter/, 'carpenter'], [/weld/, 'welder'], [/builder/, 'builder'], [/mechanic/, 'mechanic']],
    gaming:   [[/valorant/, 'Valorant'], [/fortnite/, 'Fortnite'], [/minecraft|roblox/, 'Minecraft/Roblox'], [/cs.?go/, 'CS:GO'], [/league of legends/, 'League of Legends']],
    exam:     [[/atar|hsc/, 'ATAR'], [/\bsat\b|\bact\b/, 'SAT/ACT'], [/ielts|toefl/, 'IELTS/TOEFL'], [/ucat|gamsat/, 'UCAT/GAMSAT'], [/driving test|theory test|licen/, 'Driving test']],
    language: [[/japanese|japan/, 'Japanese'], [/spanish|spain/, 'Spanish'], [/french|france/, 'French'], [/mandarin|chinese|china/, 'Mandarin'], [/korean|korea/, 'Korean'], [/arabic|arab/, 'Arabic'], [/portuguese|brazil/, 'Portuguese'], [/german|germany/, 'German'], [/italian|italy/, 'Italian'], [/russian|russia/, 'Russian'], [/hindi|punjabi/, 'Hindi'], [/turkish/, 'Turkish'], [/swahili/, 'Swahili']]
  };

  function detectSubtype(category, t) {
    if (category === 'sport') {
      for (var s = 0; s < SPORT_SUBTYPES_DETECT.length; s++) {
        if (SPORT_SUBTYPES_DETECT[s][0].test(t)) return SPORT_SUBTYPES_DETECT[s][1];
      }
      return null;
    }
    var table = SUBTYPES[category];
    if (!table) return null;
    for (var i = 0; i < table.length; i++) { if (table[i][0].test(t)) return table[i][1]; }
    return null;
  }

  function detectSportRole(sport, t) {
    var table = sport ? SPORT_ROLE_DETECT[sport] : null;
    if (!table) return null;
    for (var i = 0; i < table.length; i++) { if (table[i][0].test(t)) return table[i][1]; }
    return null;
  }

  var ROLE_BY_CATEGORY = {
    soccer: 'Footballer', sport: 'Competitor', medicine: 'Future Doctor', career: 'Professional',
    business: 'Builder', money: 'Earner', content: 'Creator', creative: 'Maker',
    fitness: 'Athlete', study: 'Scholar', screen_time: 'Operator', custom: 'Challenger',
    wellbeing: 'Recoverer', language: 'Language Learner', trade: 'Tradesperson',
    gaming: 'Gamer', confidence: 'Communicator', sleep_routine: 'Optimizer',
    discipline: 'Warrior', health_habit: 'Health Builder', exam: 'Student', lifestyle: 'Challenger',
    number_target: 'Achiever', leadership: 'Leader'
  };
  var ROLE_BY_DOMAIN_TYPE = {
    language: 'Language Learner', flight: 'Pilot', chess_strategy: 'Strategist',
    instrument: 'Musician', coding: 'Developer', cooking: 'Chef',
    technical_skill: 'Craftsperson', physical_skill: 'Practitioner',
    performance: 'Performer', knowledge: 'Scholar'
  };

  /* ═══════════ CLASSIFICATION ═══════════ */
  function classifyGoalLocal(goalText) {
    var raw = String(goalText || '').trim();
    var t = clean(raw);
    var redirect = safetyCheck(t);
    if (redirect) {
      return { goalText: raw, category: redirect.to, subtype: null, role: ROLE_BY_CATEGORY[redirect.to] || 'Challenger',
        domainType: 'general', domainNoun: '', sportRole: null,
        confidence: 0, safe: false, riskFlag: true, redirectMessage: redirect.msg, needsNarrowing: false,
        reason: 'redirected to a safe goal' };
    }
    var category = 'custom';
    for (var i = 0; i < CATEGORY_MATCHERS.length; i++) {
      if (CATEGORY_MATCHERS[i][1].test(t)) { category = CATEGORY_MATCHERS[i][0]; break; }
    }
    var subtype = detectSubtype(category, t);
    var sportRole = (category === 'sport') ? detectSportRole(subtype, t) : null;
    var domainType = getDomainType(t);
    var domainNoun = extractDomainNoun(raw);
    var words = wordCount(raw);

    var conf = 0.45;
    if (category !== 'custom') conf += 0.30;
    if (subtype) conf += 0.15;
    if (domainType !== 'general') conf += 0.10;
    if (words >= 3) conf += 0.10;
    conf = Math.round(Math.min(1, conf) * 100) / 100;

    var needsNarrowing = (category === 'custom' && domainType === 'general' && words < 3)
      || (category === 'creative' && !subtype && /famous|known|big/.test(t));

    var role = ROLE_BY_DOMAIN_TYPE[domainType] || ROLE_BY_CATEGORY[category] || 'Challenger';
    if (category === 'sport' && subtype && sportRole) {
      role = cap(subtype) + ' ' + cap(sportRole.replace(/-/g, ' '));
    }

    return {
      goalText: raw, category: category, subtype: subtype, role: role, sportRole: sportRole,
      domainType: domainType, domainNoun: domainNoun,
      confidence: conf, safe: true, riskFlag: false, needsNarrowing: needsNarrowing,
      reason: category === 'custom'
        ? (domainType !== 'general' ? 'universal domain: ' + domainType : 'no clear domain - narrowing')
        : 'matched ' + category
    };
  }

  /* ═══════════ NARROWING NODE ═══════════ */
  function narrowNode() {
    return { key: 'narrow', kind: 'category', prompt: 'Successful in what area first? Pick the one that matters most right now.',
      react: 'Good. That gives us the proof path.',
      chips: [
        { label: 'Money', value: 'money' }, { label: 'Business', value: 'business' },
        { label: 'School / grades', value: 'study' }, { label: 'Sport', value: 'sport' },
        { label: 'Fitness / health', value: 'fitness' }, { label: 'Confidence', value: 'confidence' },
        { label: 'Creative / content', value: 'creative' }, { label: 'Discipline / routine', value: 'discipline' }
      ], allowText: false, allowSkip: false };
  }

  /* ═══════════ GLOBAL QUESTIONS (every user) ═══════════ */
  function globalNodes(category) {
    var proofByCat = {
      soccer:       [['Training video', 'video'], ['Drill setup photo', 'photo'], ['Timer / log', 'timer']],
      sport:        [['Training video', 'video'], ['Drill / session photo', 'photo'], ['Timer / log', 'timer']],
      fitness:      [['Workout photo', 'photo'], ['Fitness-app screenshot', 'screenshot'], ['Timer / log', 'timer']],
      study:        [['Notes photo', 'notes'], ['Study timer', 'timer'], ['Practice questions', 'photo']],
      medicine:     [['Notes photo', 'notes'], ['Study timer', 'timer'], ['Flashcards', 'photo']],
      career:       [['Work output photo', 'photo'], ['Screenshot', 'screenshot'], ['Checklist', 'checklist']],
      business:     [['Screenshot', 'screenshot'], ['Lead/message proof', 'screenshot'], ['Built output photo', 'photo']],
      money:        [['Screenshot', 'screenshot'], ['Spreadsheet', 'screenshot'], ['Checklist', 'checklist']],
      content:      [['Published/scheduled post', 'screenshot'], ['Draft/edit photo', 'photo'], ['Short video', 'video']],
      creative:     [['Finished piece photo', 'photo'], ['Screenshot', 'screenshot'], ['Short video', 'video']],
      screen_time:  [['Screen-time screenshot', 'screenshot'], ['Timer', 'timer'], ['Task proof photo', 'photo']],
      trade:        [['Work photo', 'photo'], ['Notes / theory', 'notes'], ['Timer / log', 'timer']],
      gaming:       [['Screenshot / clip', 'screenshot'], ['Screen recording', 'video'], ['Stats screenshot', 'screenshot']],
      language:     [['Writing sample photo', 'notes'], ['Audio recording', 'audio'], ['Timer / app screenshot', 'timer']],
      confidence:   [['Timer / log', 'timer'], ['Notes / reflection', 'notes'], ['Task completed photo', 'photo']],
      sleep_routine:[['Sleep-tracker screenshot', 'screenshot'], ['Morning check-in photo', 'photo'], ['Timer', 'timer']],
      discipline:   [['Timer / log', 'timer'], ['Task completed photo', 'photo'], ['Notes', 'notes']],
      health_habit: [['Meal / drink photo', 'photo'], ['Tracker screenshot', 'screenshot'], ['Timer', 'timer']],
      exam:         [['Practice question set photo', 'notes'], ['Study timer', 'timer'], ['Flashcards', 'photo']],
      lifestyle:      [['Photo proof', 'photo'], ['Notes', 'notes'], ['Checklist', 'checklist']],
      number_target:  [['Tracker / app screenshot', 'screenshot'], ['Photo proof', 'photo'], ['Timer', 'timer']],
      custom:         [['Photo proof', 'photo'], ['Screenshot', 'screenshot'], ['Checklist', 'checklist']]
    };
    var pr = (proofByCat[category] || proofByCat.custom).map(function (p) { return { label: p[0], value: p[1] }; });
    pr.push({ label: 'Notes photo', value: 'notes' });
    return [
      { key: 'daily_minutes', kind: 'minutes', prompt: 'How much time can you prove each day?',
        react: 'Locked. We\'ll size your tasks to that.',
        chips: [{ label: '5 min', value: 5 }, { label: '10 min', value: 10 }, { label: '20 min', value: 20 }, { label: '30 min', value: 30 }, { label: '45+ min', value: 45 }] },
      { key: 'intensity', kind: 'intensity', prompt: 'How hard should VISION push you?',
        react: 'Understood.',
        chips: [
          { label: 'Light', sub: '3 tasks/day', value: 0 }, { label: 'Balanced', sub: '4 tasks/day', value: 1 },
          { label: 'Committed', sub: '5 tasks/day', value: 2 }, { label: 'Obsessed', sub: '7 tasks/day', value: 3 }
        ] },
      { key: 'preferred_time', kind: 'time', prompt: 'When will you usually do it?',
        react: 'Noted.',
        chips: [{ label: 'Morning', value: 'morning' }, { label: 'After school / work', value: 'afterschool' }, { label: 'Night', value: 'night' }, { label: 'Anytime', value: 'anytime' }] },
      { key: 'target_deadline', kind: 'deadline', prompt: 'When would you love to achieve this goal?',
        sub: 'Pick a timeline your future self would respect.',
        react: 'Locked. That\'s your target.', allowText: true,
        chips: [
          { label: '1 week',   sub: 'Urgent sprint',       value: '1 week' },
          { label: '2 weeks',  sub: 'Fast reset',          value: '2 weeks' },
          { label: '1 month',  sub: 'Serious progress',    value: '1 month' },
          { label: '2 months', sub: 'Full transformation', value: '2 months' }
        ] }
    ];
  }

  /* ═══════════ NODE HELPERS ═══════════ */
  function levelNode(chips) {
    return { key: 'level', kind: 'level', prompt: 'What level are you at right now?', react: 'Got it.', chips: chips };
  }
  function skillNode(prompt, chips, allowText) {
    return { key: 'skill_gap', kind: 'skill', prompt: prompt, react: 'That\'s what we\'ll attack.', chips: chips || [], allowText: !!allowText };
  }
  function blockerNode(chips) {
    return { key: 'blocker', kind: 'blocker', prompt: 'What usually stops you?', react: 'We\'ll design around that.',
      chips: chips || [
        { label: 'Phone / scrolling', value: 'phone' }, { label: 'Procrastination', value: 'procrastination' },
        { label: 'No clear plan', value: 'no-plan' }, { label: 'Low energy', value: 'low-energy' }, { label: 'Inconsistency', value: 'inconsistency' }
      ] };
  }
  function chipify(arr) { return arr.map(function (x) { return Array.isArray(x) ? { label: x[0], value: x[1] } : { label: x, value: clean(x) }; }); }

  /* ═══════════ CATEGORY TREES ═══════════ */

  function soccerTree(c) {
    var nodes = [];
    var pos = c.subtype && /keeper|winger|striker|midfielder|defender/.test(c.subtype) ? c.subtype : null;
    if (!pos) {
      nodes.push({ key: 'position', kind: 'position', prompt: 'What position are you building for?', react: 'That sets the proof path.',
        chips: chipify([['Striker', 'striker'], ['Winger', 'winger'], ['Midfielder', 'midfielder'], ['Defender', 'defender'], ['Goalkeeper', 'goalkeeper'], ['Not sure', 'unsure']]) });
    }
    var gkSkills = chipify([['Handling', 'handling'], ['Reactions', 'reactions'], ['Footwork', 'footwork'], ['Positioning', 'positioning'], ['Distribution', 'distribution']]);
    var outfield = chipify([['Finishing', 'finishing'], ['Dribbling', 'dribbling'], ['First touch', 'first-touch'], ['Weak foot', 'weak-foot'], ['Speed', 'speed'], ['Stamina', 'stamina']]);
    nodes.push(skillNode(pos === 'goalkeeper' ? 'What part of your keeping needs most work?' : 'What part of your game needs most work?', pos === 'goalkeeper' ? gkSkills : outfield));
    nodes.push(levelNode(chipify([['Casual', 'casual'], ['School team', 'school'], ['Club', 'club'], ['Academy', 'academy'], ['Competitive', 'competitive']])));
    nodes.push({ key: 'access', kind: 'access', prompt: 'What can you access most days?', react: 'We\'ll build around that.',
      chips: chipify([['Ball', 'ball'], ['Wall', 'wall'], ['Field', 'field'], ['Cones', 'cones'], ['Gym', 'gym'], ['Small space', 'small-space']]) });
    return nodes;
  }

  function sportTree(c) {
    var sport = c.subtype;
    var sportRole = c.sportRole || null;
    var nodes = [];
    var roleChips = sport ? SPORT_ROLE_CHIPS[sport] : null;

    if (roleChips) {
      if (!sportRole) {
        nodes.push({ key: 'position', kind: 'position',
          prompt: 'What type of ' + sport + ' player are you building into?',
          react: 'That sets the proof path.',
          chips: chipify(roleChips) });
      }
      var skillArr = sportSkillChips(sport, sportRole);
      var skillPrompt = (sport && sportRole)
        ? 'What part of your ' + sportRole.replace(/-/g, ' ') + ' game needs most work?'
        : 'What needs most work in your ' + (sport || 'sport') + ' game?';
      nodes.push(skillNode(skillPrompt, chipify(skillArr)));
    } else {
      if (!sport) {
        nodes.push({ key: 'subtype', kind: 'subtype',
          prompt: 'What sport are you training for?',
          react: 'Got it.', allowText: true,
          chips: chipify([['Cricket', 'cricket'], ['Basketball', 'basketball'], ['Combat sport', 'combat'], ['Athletics / running', 'running'], ['Swimming', 'swimming']]) });
      }
      var skillArr2 = sportSkillChips(sport, null);
      nodes.push(skillNode(
        sport ? 'What needs most work in your ' + sport + ' game?' : 'What skill needs the most work?',
        chipify(skillArr2)
      ));
    }

    nodes.push(levelNode(chipify([['Casual / recreational', 'casual'], ['School / club', 'club'], ['Competitive', 'competitive'], ['Elite / academy', 'elite']])));
    nodes.push({ key: 'access', kind: 'access',
      prompt: 'What training access do you have most days?', react: 'We\'ll build around that.',
      chips: chipify([['Training alone', 'solo'], ['Team / squad training', 'team'], ['Professional coaching', 'coaching'], ['Gym access', 'gym'], ['Mixed / varies', 'mixed']]) });
    return nodes;
  }

  function medicineTree(c) {
    var nodes = [];
    if (!c.subtype) {
      nodes.push({ key: 'subtype', kind: 'subtype', prompt: 'What type of doctor are you aiming for?', react: 'That focuses the path.',
        chips: chipify([['GP', 'GP'], ['Surgeon', 'surgeon'], ['Emergency', 'emergency doctor'], ['Sports doctor', 'sports doctor'], ['Paediatrician', 'paediatrician'], ['Not sure', 'unsure']]) });
    }
    nodes.push(levelNode(chipify([['High school', 'high-school'], ['University', 'university'], ['Exam prep', 'exam-prep'], ['Exploring', 'exploring']])));
    nodes.push(skillNode('What subject needs most work?', chipify([['Biology', 'biology'], ['Chemistry', 'chemistry'], ['Maths', 'maths'], ['English', 'english'], ['Study routine', 'routine']])));
    nodes.push(blockerNode());
    return nodes;
  }

  function careerTree(c) {
    var nodes = [];
    if (!c.subtype) nodes.push({ key: 'subtype', kind: 'subtype', prompt: 'What career are you building toward?', react: 'Locked in.', allowText: true,
      chips: chipify([['Lawyer', 'lawyer'], ['Engineer', 'engineer'], ['Developer', 'developer'], ['Designer', 'designer'], ['Teacher', 'teacher']]) });
    // law has a meaningful specialisation choice — ask it (brief: Criminal / Business / Family / Human rights)
    if (c.subtype === 'lawyer' || /lawyer|barrister|solicitor|\blaw\b/.test(clean(c.goalText || ''))) {
      nodes.push({ key: 'specialisation', kind: 'subtype', prompt: 'What type of law interests you most?', react: 'Good — that shapes the path.',
        chips: chipify([['Criminal', 'criminal'], ['Business / corporate', 'business'], ['Family', 'family'], ['Human rights', 'human-rights'], ['Not sure yet', 'unsure']]) });
    }
    nodes.push(levelNode(chipify([['Still at school', 'school'], ['At university', 'university'], ['Job hunting', 'job-hunting'], ['Already working', 'working']])));
    nodes.push(skillNode('What matters most to build now?', chipify([['Core skill', 'skill'], ['Portfolio', 'portfolio'], ['Applications', 'applications'], ['Interview prep', 'interview'], ['Communication', 'communication']])));
    return nodes;
  }

  function businessTree(c) {
    var nodes = [];
    if (!c.subtype) nodes.push({ key: 'subtype', kind: 'subtype', prompt: 'What are you trying to build?', react: 'Got the shape of it.', allowText: true,
      chips: chipify([['Service / agency', 'service business'], ['App / SaaS', 'app/SaaS'], ['Ecommerce', 'ecommerce'], ['Content', 'content business'], ['Local business', 'local business'], ['Investing / saving', 'investing']]) });
    nodes.push(levelNode(chipify([['Idea', 'idea'], ['Building', 'building'], ['First customers', 'first-customers'], ['Trying to grow', 'growing']])));
    nodes.push(skillNode('What\'s the bottleneck?', chipify([['Offer', 'offer'], ['Leads', 'leads'], ['Website', 'website'], ['Sales', 'sales'], ['Content', 'content'], ['Consistency', 'consistency']])));
    return nodes;
  }

  function moneyTree(c) {
    var t = clean((c && c.goalText) || '');
    var earning = /\b(make|earn|income|\d+\s*k|\$\s?\d|\d{3,}|rich|wealth|side hustle|side income|passive|online|business|sell|client|freelanc)\b/.test(t)
      && !/\b(save|saving|budget|debt|spend|overspend)\b/.test(t);
    if (earning) {
      // EARN path: method → bottleneck → level (matches brief's "make 10k/month")
      return [
        { key: 'subtype', kind: 'subtype', prompt: 'How do you want to make it first?', react: 'Good - that\'s the engine we\'ll build.',
          chips: chipify([['Local service', 'local service'], ['Online business', 'online business'], ['Job / career', 'job'], ['Content', 'content'], ['Sales', 'sales'], ['Freelancing', 'freelancing'], ['Not sure', 'unsure']]) },
        skillNode('What\'s the biggest bottleneck right now?', chipify([['No offer', 'no offer'], ['No leads', 'no leads'], ['No skill', 'no skill'], ['No audience', 'no audience'], ['No consistency', 'no consistency'], ['Not sure', 'unsure']])),
        levelNode(chipify([['£0 / nothing yet', 'zero'], ['A little coming in', 'some'], ['Steady but small', 'steady'], ['Trying to scale', 'scaling']]))
      ];
    }
    // SAVE / manage path: general habits only, no financial advice
    return [
      { key: 'subtype', kind: 'subtype', prompt: 'What\'s your money path?', react: 'Noted - general habits only, no financial advice.',
        chips: chipify([['Save more', 'saving'], ['Earn more', 'income'], ['Start earning online', 'online'], ['Invest / discipline', 'investing']]) },
      skillNode('What\'s the bottleneck?', chipify([['Overspending', 'overspending'], ['No income action', 'income'], ['No tracking', 'tracking'], ['Consistency', 'consistency']])),
      levelNode(chipify([['Just starting', 'start'], ['Some progress', 'progress'], ['Stuck', 'stuck']]))
    ];
  }

  function leadershipTree() {
    return [
      { key: 'subtype', kind: 'subtype', prompt: 'What kind of leadership are you building?', react: 'Locked in.',
        chips: chipify([['Team at work', 'work team'], ['Sports captain', 'sports captain'], ['School / club', 'school group'], ['Own business / founder', 'founder'], ['General influence', 'influence']]) },
      skillNode('What part of leading needs most work?', chipify([['Communication', 'communication'], ['Decision making', 'decisions'], ['Delegation', 'delegation'], ['Confidence / presence', 'presence'], ['Accountability', 'accountability'], ['Conflict handling', 'conflict']])),
      levelNode(chipify([['Never led before', 'beginner'], ['Lead informally', 'informal'], ['Lead a small group', 'small'], ['Lead a real team', 'experienced']])),
      blockerNode(chipify([['Fear of speaking up', 'fear'], ['Avoid hard conversations', 'avoidance'], ['Doing everything myself', 'no-delegation'], ['Inconsistency', 'inconsistency']]))
    ];
  }

  function fitnessTree(c) {
    var nodes = [];
    if (!c.subtype) nodes.push({ key: 'subtype', kind: 'subtype', prompt: 'What\'s the target?', react: 'Health and consistency first.',
      chips: chipify([['Strength', 'strength'], ['Health / energy', 'health'], ['Stamina', 'endurance'], ['Sport performance', 'performance'], ['Consistency', 'consistency']]) });
    nodes.push({ key: 'access', kind: 'access', prompt: 'What equipment do you have?', react: 'We\'ll build around that.',
      chips: chipify([['None', 'none'], ['Dumbbells', 'dumbbells'], ['Full gym', 'gym'], ['Home space', 'home'], ['Field / outdoors', 'outdoors']]) });
    nodes.push(blockerNode(chipify([['Low energy', 'low-energy'], ['No plan', 'no-plan'], ['No time', 'time'], ['Soreness', 'soreness'], ['Consistency', 'inconsistency']])));
    nodes.push(levelNode(chipify([['Beginner', 'beginner'], ['Returning', 'returning'], ['Intermediate', 'intermediate'], ['Advanced', 'advanced']])));
    return nodes;
  }

  function studyTree(c) {
    var nodes = [];
    if (!c.subtype) nodes.push({ key: 'subtype', kind: 'subtype', prompt: 'What subject are you focused on?', react: 'Locked.', allowText: true,
      chips: chipify([['Maths', 'maths'], ['Science', 'science'], ['English', 'english'], ['Exam prep', 'exam prep']]) });
    nodes.push(skillNode('What\'s weakest right now?', chipify([['Notes', 'notes'], ['Practice questions', 'practice'], ['Focus', 'focus'], ['Memory', 'memory'], ['Assignments', 'assignments']])));
    nodes.push(levelNode(chipify([['Falling behind', 'behind'], ['Average', 'average'], ['Doing OK', 'ok'], ['Chasing top marks', 'top']])));
    nodes.push(blockerNode());
    return nodes;
  }

  function contentTree(c) {
    var nodes = [];
    if (!c.subtype) nodes.push({ key: 'subtype', kind: 'subtype', prompt: 'What platform are you building on?', react: 'Good.',
      chips: chipify([['YouTube', 'YouTube'], ['TikTok', 'TikTok'], ['Instagram', 'Instagram'], ['Podcast', 'podcast'], ['Streaming', 'streaming']]) });
    nodes.push(skillNode('What output counts as proof?', chipify([['Script', 'script'], ['Recorded clip', 'clip'], ['Edit', 'edit'], ['Published post', 'post']])));
    nodes.push(skillNode('What blocks consistency?', chipify([['Ideas', 'ideas'], ['Editing', 'editing'], ['Fear of posting', 'fear'], ['Time', 'time']])));
    return nodes;
  }

  function creativeTree(c) {
    var nodes = [];
    if (!c.subtype) nodes.push({ key: 'subtype', kind: 'subtype', prompt: 'What are you trying to create?', react: 'Got it.', allowText: true,
      chips: chipify([['Writing', 'writer'], ['Music', 'musician'], ['Art / design', 'artist'], ['Film / video', 'filmmaker'], ['Photography', 'photographer']]) });
    nodes.push(skillNode('What output counts as proof?', chipify([['Finished piece', 'finished'], ['Draft / sketch', 'draft'], ['Published work', 'published'], ['Practice rep', 'practice']])));
    nodes.push(blockerNode(chipify([['Perfectionism', 'fear'], ['No time', 'time'], ['No ideas', 'no-plan'], ['Inconsistency', 'inconsistency']])));
    return nodes;
  }

  function screenTimeTree() {
    return [
      { key: 'subtype', kind: 'subtype', prompt: 'What app wastes the most time?', react: 'That\'s the target.', allowText: true,
        chips: chipify([['TikTok', 'tiktok'], ['Instagram', 'instagram'], ['YouTube', 'youtube'], ['Games', 'games'], ['Snapchat', 'snapchat']]) },
      { key: 'access', kind: 'window', prompt: 'When does it happen most?', react: 'Noted.',
        chips: chipify([['Morning', 'morning'], ['After school', 'afterschool'], ['Night', 'night'], ['In bed', 'in-bed']]) },
      skillNode('What replaces it?', chipify([['Study', 'study'], ['Sport', 'sport'], ['Reading', 'reading'], ['Sleep', 'sleep'], ['Business', 'business'], ['Fitness', 'fitness']]))
    ];
  }

  function tradeTree(c) {
    var nodes = [];
    if (!c.subtype) {
      nodes.push({ key: 'subtype', kind: 'subtype', prompt: 'What trade are you targeting?', react: 'Locked in.', allowText: true,
        chips: chipify([['Electrician', 'electrician'], ['Plumber', 'plumber'], ['Carpenter', 'carpenter'], ['Welder', 'welder'], ['Builder / labourer', 'builder'], ['Auto mechanic', 'mechanic']]) });
    }
    nodes.push(levelNode(chipify([['Just starting / exploring', 'exploring'], ['Pre-apprentice / school', 'school'], ['Apprentice (1st year)', 'year1'], ['Apprentice (2nd–3rd year)', 'year2-3'], ['Qualified', 'qualified']])));
    nodes.push(skillNode('What do you most need to build?', chipify([['Practical technique', 'technique'], ['Theory / code knowledge', 'theory'], ['Tool use & safety', 'tools'], ['On-site experience', 'onsite'], ['Precision / accuracy', 'precision'], ['Exam / licence prep', 'exam']])));
    nodes.push(blockerNode(chipify([['No work experience', 'no-experience'], ['Hard to get an apprenticeship', 'hard-to-get'], ['Theory knowledge', 'theory'], ['Consistency', 'inconsistency']])));
    return nodes;
  }

  function gamingTree() {
    return [
      { key: 'subtype', kind: 'subtype', prompt: 'What game or path?', react: 'Got it.', allowText: true,
        chips: chipify([['Ranked / competitive', 'competitive'], ['Minecraft / Roblox', 'sandbox'], ['Streamer', 'streamer'], ['Esports pro', 'esports']]) },
      skillNode('What\'s the focus?', chipify([['Game mechanics / aim', 'mechanics'], ['Game sense / strategy', 'strategy'], ['Consistency', 'consistency'], ['Rank up', 'rank'], ['Grow an audience', 'audience']])),
      levelNode(chipify([['Casual / new', 'casual'], ['Average rank', 'average'], ['Good rank / semi-serious', 'good'], ['Top rank / high level', 'top']]))
    ];
  }

  function languageTree(c) {
    var nodes = [];
    if (!c.subtype) {
      nodes.push({ key: 'subtype', kind: 'subtype', prompt: 'Which language are you learning?', react: 'Great choice.', allowText: true,
        chips: chipify([['Japanese', 'Japanese'], ['Spanish', 'Spanish'], ['French', 'French'], ['Arabic', 'Arabic'], ['Mandarin', 'Mandarin'], ['Hindi / Punjabi', 'Hindi'], ['Korean', 'Korean']]) });
    }
    var lang = c.subtype || 'the language';
    nodes.push(levelNode(chipify([['Complete beginner', 'beginner'], ['Know basics / some words', 'basics'], ['Conversational', 'conversational'], ['Intermediate', 'intermediate'], ['Advanced', 'advanced']])));
    nodes.push(skillNode('What needs most work in your ' + lang + ' journey?', chipify([['Vocabulary', 'vocabulary'], ['Grammar', 'grammar'], ['Speaking', 'speaking'], ['Listening', 'listening'], ['Reading / writing', 'reading']])));
    return nodes;
  }

  function confidenceTree() {
    return [
      { key: 'subtype', kind: 'subtype', prompt: 'What situation do you want to handle better?', react: 'Understood.',
        chips: chipify([['Talking to new people', 'new-people'], ['Presentations / speaking', 'presenting'], ['Social events / parties', 'events'], ['Job interviews', 'interviews'], ['All of the above', 'all']]) },
      skillNode('What aspect of your communication needs the most work?', chipify([['Delivery / pacing', 'delivery'], ['Stage presence', 'presence'], ['Handling nerves', 'nerves'], ['Material / ideas', 'material'], ['Memorisation', 'memory']])),
      levelNode(chipify([['Very nervous / avoidant', 'avoidant'], ['Can do it but anxious', 'anxious'], ['OK but want to improve', 'ok'], ['Generally confident', 'confident']])),
      blockerNode(chipify([['Fear of being judged', 'judgment'], ['Overthinking / freezing', 'overthinking'], ['No practice opportunities', 'no-practice'], ['Past bad experience', 'past-experience']]))
    ];
  }

  function sleepRoutineTree() {
    return [
      { key: 'subtype', kind: 'subtype', prompt: 'What\'s the main issue?', react: 'Got it.',
        chips: chipify([['Can\'t fall asleep', 'cant-sleep'], ['Waking up too late', 'wake-late'], ['No morning routine', 'no-morning'], ['Tired all day', 'tired'], ['No night routine', 'no-night']]) },
      skillNode('What usually gets in the way?', chipify([['Phone in bed', 'phone'], ['Inconsistent bedtime', 'inconsistent'], ['Caffeine / diet', 'caffeine'], ['Stress / overthinking', 'stress'], ['Late night gaming / content', 'gaming']])),
      levelNode(chipify([['Very irregular (no pattern)', 'no-pattern'], ['Trying but failing', 'trying'], ['Mostly OK, small tweaks', 'mostly-ok']]))
    ];
  }

  function disciplineTree() {
    return [
      { key: 'subtype', kind: 'subtype', prompt: 'What behaviour are you trying to beat?', react: 'That\'s the target.',
        chips: chipify([['Phone / scrolling', 'phone'], ['Procrastinating on work', 'procrastination'], ['Low energy / laziness', 'laziness'], ['Gaming too much', 'gaming'], ['Missing goals / inconsistency', 'inconsistency']]) },
      skillNode('What should replace it?', chipify([['Study / school work', 'study'], ['Gym / training', 'training'], ['A skill or project', 'skill'], ['Sleep routine', 'sleep'], ['Reading / journalling', 'reading']])),
      blockerNode(chipify([['Phone addiction', 'phone'], ['No environment control', 'environment'], ['No clear why', 'no-why'], ['Low energy', 'low-energy']]))
    ];
  }

  function healthHabitTree() {
    return [
      { key: 'subtype', kind: 'subtype', prompt: 'What healthy habit are you building?', react: 'Health first.',
        chips: chipify([['Drink more water', 'hydration'], ['Eat healthier / less junk', 'nutrition'], ['Consistent exercise', 'exercise'], ['Less caffeine / alcohol', 'caffeine'], ['Better gut health', 'gut']]) },
      levelNode(chipify([['Unhealthy right now', 'poor'], ['Some good days, some bad', 'mixed'], ['Generally OK, want better', 'ok']])),
      blockerNode(chipify([['Cravings / habits', 'cravings'], ['Convenience / laziness', 'convenience'], ['No routine', 'no-routine'], ['Social pressure', 'social']]))
    ];
  }

  function examTree(c) {
    var nodes = [];
    if (!c.subtype) {
      nodes.push({ key: 'subtype', kind: 'subtype', prompt: 'Which exam?', react: 'Locked in.', allowText: true,
        chips: chipify([['ATAR / HSC', 'ATAR'], ['SAT / ACT', 'SAT'], ['IELTS / TOEFL', 'IELTS'], ['UCAT / GAMSAT', 'UCAT'], ['Bar exam / law boards', 'bar-exam'], ['Driving test', 'driving']]) });
    }
    nodes.push(skillNode('Which area needs most work?', chipify([['Content knowledge', 'content'], ['Exam technique', 'technique'], ['Time management in exam', 'timing'], ['Practice questions', 'practice'], ['Writing / essays', 'writing']])));
    nodes.push({ key: 'exam_when', kind: 'time', prompt: 'How long until the exam?', react: 'We\'ll pace your plan.',
      chips: chipify([['Less than 1 month', 'imminent'], ['1–3 months', '1-3months'], ['3–6 months', '3-6months'], ['6+ months', '6plus']]) });
    return nodes;
  }

  function numberTargetTree(c) {
    var domainNoun = (c && c.domainNoun) ? c.domainNoun : 'your target';
    return [
      { key: 'current_number', kind: 'metric',
        prompt: 'Where are you starting from right now?',
        react: 'Got it - that\'s the baseline.',
        allowText: true,
        chips: chipify([['Just starting / zero', 'zero'], ['A little way in', 'some'], ['Roughly halfway', 'halfway'], ['Almost there', 'close']]) },
      skillNode('What\'s the main action that moves ' + domainNoun + ' forward?',
        chipify([['Daily tracking / logging', 'tracking'], ['Consistent action / reps', 'reps'], ['Building a habit', 'habit'], ['Removing a blocker', 'blocker'], ['Outreach / applications', 'outreach']]), true),
      blockerNode(chipify([['Old habits / spending', 'habits'], ['Inconsistency', 'inconsistency'], ['No tracking system', 'no-tracking'], ['Low motivation', 'motivation'], ['No time', 'time']]))
    ];
  }

  function lifestyleTree() {
    return [
      { key: 'subtype', kind: 'subtype', prompt: 'What area of your life needs the most work right now?', react: 'Good. Let\'s focus there.',
        chips: chipify([['School / career', 'school-career'], ['Fitness / health', 'fitness-health'], ['Discipline / routine', 'discipline'], ['Confidence / social', 'confidence'], ['Money / work', 'money-work'], ['Relationships / mindset', 'mindset']]) },
      blockerNode(chipify([['Phone / distraction', 'phone'], ['Procrastination / laziness', 'procrastination'], ['No clear plan', 'no-plan'], ['Low energy', 'low-energy'], ['Inconsistency', 'inconsistency']]))
    ];
  }

  /* ═══════════ UNIVERSAL TREE (domain-type driven) ═══════════ */
  var DOMAIN_SKILL_CHIPS = {
    language:       [['Vocabulary', 'vocabulary'], ['Grammar', 'grammar'], ['Speaking', 'speaking'], ['Listening', 'listening'], ['Reading', 'reading'], ['Writing', 'writing']],
    flight:         [['Theory / exams', 'theory'], ['Navigation', 'navigation'], ['Radio comms', 'radio'], ['Landings', 'landings'], ['Instrument flying', 'instruments'], ['Cross-country', 'cross-country']],
    chess_strategy: [['Tactics', 'tactics'], ['Openings', 'openings'], ['Endgame', 'endgame'], ['Strategy / positional', 'strategy'], ['Calculation speed', 'calculation'], ['Time management', 'time']],
    instrument:     [['Technique', 'technique'], ['Music theory', 'theory'], ['Sight reading', 'sight-reading'], ['Repertoire', 'repertoire'], ['Speed / control', 'speed'], ['Ear training', 'ear']],
    coding:         [['Core concepts', 'concepts'], ['Problem solving', 'problem-solving'], ['Building projects', 'projects'], ['Debugging', 'debugging'], ['Algorithms', 'algorithms'], ['Specific skill', 'specific']],
    cooking:        [['Knife technique', 'technique'], ['Flavour / seasoning', 'seasoning'], ['Timing & heat', 'timing'], ['Recipe variety', 'variety'], ['Plating / presentation', 'presentation'], ['Specific cuisine', 'cuisine']],
    technical_skill:[['Core technique', 'technique'], ['Precision / accuracy', 'precision'], ['Speed / efficiency', 'speed'], ['Tool use', 'tools'], ['Problem diagnosis', 'diagnosis']],
    physical_skill: [['Technique / form', 'technique'], ['Flexibility', 'flexibility'], ['Strength', 'strength'], ['Balance / control', 'balance'], ['Specific move', 'specific'], ['Consistency', 'consistency']],
    performance:    [['Material / ideas', 'material'], ['Delivery / pacing', 'delivery'], ['Stage presence', 'presence'], ['Memorisation', 'memory'], ['Handling nerves', 'nerves']],
    knowledge:      [['Core concepts', 'fundamentals'], ['Deep study / depth', 'depth'], ['Application', 'application'], ['Memory retention', 'memory'], ['Problem solving', 'problem-solving']]
  };

  var DOMAIN_LEVEL_CHIPS = {
    language:       [['Complete beginner', 'beginner'], ['Know basics', 'basics'], ['Conversational', 'conversational'], ['Intermediate', 'intermediate'], ['Advanced', 'advanced']],
    flight:         [['No hours yet', 'zero'], ['Student pilot', 'student'], ['Private pilot (PPL)', 'ppl'], ['Working on rating', 'rating'], ['Commercial / above', 'commercial']],
    chess_strategy: [['New to it', 'beginner'], ['Know the rules', 'rules'], ['Club / casual', 'club'], ['Rated player', 'rated'], ['Serious study', 'serious']],
    instrument:     [['Never played', 'beginner'], ['Early learner', 'early'], ['Intermediate', 'intermediate'], ['Gigging / recording', 'advanced']],
    coding:         [['No experience', 'beginner'], ['Basics only', 'basics'], ['Small projects done', 'projects'], ['Working professionally', 'professional']],
    cooking:        [['Basics only', 'basics'], ['Home cook', 'home'], ['Confident cook', 'confident'], ['Semi-professional', 'semi-pro']],
    physical_skill: [['Complete beginner', 'beginner'], ['Some experience', 'some'], ['Intermediate', 'intermediate'], ['Advanced practitioner', 'advanced']],
    general:        [['Just starting', 'start'], ['Some experience', 'progress'], ['Intermediate', 'intermediate'], ['Experienced', 'advanced']]
  };

  function universalTree(c) {
    var domainType = (c && c.domainType) || 'general';
    var domainNoun = (c && c.domainNoun) ? cap(c.domainNoun) : 'this';
    var nodes = [];
    var levelChips = DOMAIN_LEVEL_CHIPS[domainType] || DOMAIN_LEVEL_CHIPS.general;
    nodes.push(levelNode(chipify(levelChips)));
    var skillChips = DOMAIN_SKILL_CHIPS[domainType];
    if (skillChips && skillChips.length) {
      nodes.push(skillNode('What part of ' + domainNoun + ' needs most work?', chipify(skillChips)));
    } else {
      nodes.push({ key: 'skill_gap', kind: 'skill',
        prompt: 'What specifically do you want to improve about ' + domainNoun + '?',
        react: 'That\'s what we\'ll attack.',
        chips: [], allowText: true, allowSkip: false });
    }
    nodes.push(blockerNode());
    return nodes;
  }

  /* ═══════════ TREE ROUTER ═══════════ */
  var TREE_BUILDERS = {
    soccer: soccerTree, sport: sportTree, medicine: medicineTree, career: careerTree,
    business: businessTree, money: moneyTree, fitness: fitnessTree, study: studyTree,
    content: contentTree, creative: creativeTree, screen_time: screenTimeTree,
    trade: tradeTree, gaming: gamingTree, language: languageTree,
    confidence: confidenceTree, sleep_routine: sleepRoutineTree, discipline: disciplineTree,
    health_habit: healthHabitTree, exam: examTree, lifestyle: lifestyleTree,
    number_target: numberTargetTree, leadership: leadershipTree,
    custom: universalTree, wellbeing: universalTree
  };

  function treeFor(classification) {
    var c = classification || { category: 'custom' };
    var builder = TREE_BUILDERS[c.category] || universalTree;
    var goalNodes = builder(c) || [];
    return goalNodes.concat(globalNodes(c.category));
  }

  /* ═══════════════════════════════════════════════════════════════
     UNIVERSAL PATH GRAPH
     Turns any safe classification + answers into a complete proof path:
     path_type · target level · resources · 7-day plan · first proof task
     · daily task strategy. Pure & deterministic — no network.
  ═══════════════════════════════════════════════════════════════ */

  // category (+ domainType for custom) → normalised path_type (brief's 25 types)
  var PATH_TYPE_BY_CATEGORY = {
    soccer: 'sport', sport: 'sport', fitness: 'fitness', study: 'study', exam: 'exam',
    career: 'career', medicine: 'career', trade: 'trade', business: 'business',
    money: 'money_business', content: 'content', creative: 'creative', music: 'music',
    language: 'language', screen_time: 'screen_time', sleep_routine: 'sleep',
    confidence: 'confidence', discipline: 'habit', health_habit: 'health_habit',
    lifestyle: 'lifestyle', number_target: 'number_target', leadership: 'leadership',
    gaming: 'gaming', wellbeing: 'health_habit', custom: 'custom'
  };
  var PATH_TYPE_BY_DOMAIN_TYPE = {
    coding: 'tech', instrument: 'music', language: 'language', cooking: 'skill_learning',
    flight: 'skill_learning', technical_skill: 'trade', physical_skill: 'skill_learning',
    performance: 'confidence', chess_strategy: 'skill_learning', knowledge: 'study'
  };
  function pathTypeFor(c) {
    if (!c) return 'custom';
    // money split: saving/budgeting is a habit path, not lead-gen
    if (c.category === 'money') {
      var mt = clean(c.goalText || '');
      var saving = /\b(save|saving|budget|debt|spend|overspend|emergency fund)\b/.test(mt)
        && !/\b(make|earn|income|business|client|sell|side hustle|freelanc|\dk\s*(\/|a |per )?month)\b/.test(mt);
      return saving ? 'money_save' : 'money_business';
    }
    // strong domain-type signals override a loose category match
    // (e.g. "data science" matches study's `science` but is really tech/coding)
    var STRONG_DOMAIN = { coding: 'tech', instrument: 'music', flight: 'skill_learning' };
    if (c.domainType && STRONG_DOMAIN[c.domainType] && c.category !== 'sport') {
      return STRONG_DOMAIN[c.domainType];
    }
    var base = PATH_TYPE_BY_CATEGORY[c.category];
    if ((c.category === 'custom' || !base) && c.domainType && c.domainType !== 'general') {
      return PATH_TYPE_BY_DOMAIN_TYPE[c.domainType] || base || 'skill_learning';
    }
    return base || 'custom';
  }

  // a human-facing target level for the proof system header
  function targetLevelFor(profile) {
    var t = clean(profile.goalText || '');
    var isMoneyish = profile.pathType === 'money_business' || profile.pathType === 'money_save'
      || profile.pathType === 'number_target'
      || /\b(save|saving|earn|make|income|rich|wealth)\b|\$|£|€/.test(t);
    var money = t.match(/(\$|£|€)?\s?(\d[\d,\.]{0,8})\s*(k\b|grand|thousand)?/);
    if (isMoneyish && money && money[2]) {
      var sym = money[1] || '';
      var num = money[2];
      var kSuffix = /\b\d+\s*(k\b|grand|thousand)/.test(t) && !/000/.test(num) ? 'k' : '';
      var per = /month|monthly|\/month/.test(t) ? '/month' : '';
      return (sym || '$') + num + kSuffix + per;
    }
    var byType = {
      sport: 'competitive level', fitness: 'consistent, stronger, higher energy',
      study: 'top of your class', exam: 'pass with a strong score', career: 'job-ready / hired',
      trade: 'qualified tradesperson', business: 'paying customers', money_business: 'first consistent income',
      content: 'a posting habit + growing audience', creative: 'a finished, shared body of work',
      music: 'play full pieces confidently', language: 'conversational', screen_time: 'phone under control',
      sleep: 'a steady sleep + wake rhythm', confidence: 'speak up without freezing',
      habit: 'a habit that holds without willpower', health_habit: 'a healthy daily default',
      leadership: 'a team that trusts you', lifestyle: 'visible momentum in your chosen area',
      number_target: 'hit your number', tech: 'ship a working project', skill_learning: 'reliably skilled',
      gaming: 'climb to your target rank', custom: 'visible, proven progress'
    };
    return byType[profile.pathType] || 'visible, proven progress';
  }

  // normalise resources from the access/equipment answer + sensible defaults
  function resourcesFrom(answers, profile) {
    var a = answers || {};
    var picked = a.access || a.equipment || null;
    var map = {
      gym: 'gym', dumbbells: 'dumbbells', home: 'home space', 'home-space': 'home space',
      outdoors: 'outdoor space', field: 'field', ball: 'a ball', wall: 'a wall', cones: 'cones',
      none: 'bodyweight only', 'small-space': 'small space', solo: 'solo training',
      team: 'team / squad', coaching: 'a coach', mixed: 'mixed access'
    };
    var out = [];
    if (picked && map[picked]) out.push(map[picked]);
    else if (picked && typeof picked === 'string') out.push(picked.replace(/-/g, ' '));
    var defaultsByType = {
      money_business: ['phone', 'laptop', 'internet'], money_save: ['a budgeting app', 'a tracker'],
      business: ['phone', 'laptop', 'internet'],
      tech: ['laptop', 'internet'], content: ['phone', 'editing app'], creative: ['phone or notebook'],
      music: ['your instrument'], language: ['phone', 'a notebook'], study: ['notes', 'past papers'],
      exam: ['notes', 'practice papers'], career: ['laptop', 'internet'], confidence: ['daily situations'],
      leadership: ['your team / group'], sport: ['training space'], fitness: ['your body']
    };
    var d = defaultsByType[profile.pathType] || ['phone', 'a notebook'];
    for (var i = 0; i < d.length && out.length < 3; i++) { if (out.indexOf(d[i]) < 0) out.push(d[i]); }
    return out.slice(0, 3);
  }

  // first concrete proof action for day one
  function firstProofTask(profile) {
    var noun = profile.goalSubtype || profile.domainNoun || profile.goalText || 'your goal';
    var gap = profile.mainSkillGap ? String(profile.mainSkillGap).replace(/-/g, ' ') : null;
    var byType = {
      sport: { title: 'Do one focused ' + (gap || 'skill') + ' drill', proof: 'Film a short clip or photo of your setup' },
      fitness: { title: 'Complete one short session', proof: 'Photo mid-set or a fitness-app screenshot' },
      study: { title: 'Do 10 practice questions on your weakest topic', proof: 'Photo of your worked answers' },
      exam: { title: 'Do one timed practice set', proof: 'Photo of the completed set' },
      career: { title: 'Build one piece of your portfolio or application', proof: 'Screenshot or photo of the output' },
      trade: { title: 'Practise one core technique', proof: 'Photo of your work / setup' },
      business: { title: 'Define your offer in one sentence', proof: 'Screenshot of it written down' },
      money_business: { title: 'Write your offer + find 5 leads', proof: 'Screenshot of your list' },
      money_save: { title: 'Track every expense today + set a savings target', proof: 'Screenshot of your tracker / list' },
      content: { title: 'Script or record one short piece', proof: 'Screenshot of the draft or the clip' },
      creative: { title: 'Make one small finished piece', proof: 'Photo of the finished work' },
      music: { title: 'Practise one passage slowly for 10 minutes', proof: 'Short audio or video clip' },
      language: { title: 'Learn + use 10 new words today', proof: 'Photo of your written sentences' },
      screen_time: { title: 'Replace one scroll session with a real task', proof: 'Screen-time screenshot' },
      sleep: { title: 'Set a fixed lights-out time tonight', proof: 'Morning check-in photo / tracker shot' },
      confidence: { title: 'Start one short conversation today', proof: 'A quick note of how it went' },
      habit: { title: 'Do the new habit once, on time', proof: 'Photo or timer showing you did it' },
      health_habit: { title: 'Do the healthy swap once today', proof: 'Photo of the meal / drink / action' },
      leadership: { title: 'Have one clear conversation with someone you lead', proof: 'A short note on what you said' },
      lifestyle: { title: 'Take one concrete action in your chosen area', proof: 'Photo proof of the action' },
      number_target: { title: 'Log today\'s number and do one rep toward it', proof: 'Tracker / app screenshot' },
      tech: { title: 'Build one tiny working feature', proof: 'Screenshot of it running' },
      skill_learning: { title: 'Do one focused 15-minute practice rep', proof: 'Photo or clip of the practice' },
      gaming: { title: 'Do one focused mechanics drill or review one match', proof: 'Screenshot / clip' },
      custom: { title: 'Take one concrete step toward ' + noun, proof: 'Photo proof of the step' }
    };
    return byType[profile.pathType] || byType.custom;
  }

  // 7-day proof plan — parameterised by subtype / skill gap / noun
  function sevenDayPlan(profile) {
    var pt = profile.pathType;
    var noun = profile.goalSubtype || profile.domainNoun || 'your goal';
    var gap = profile.mainSkillGap ? String(profile.mainSkillGap).replace(/-/g, ' ') : 'your weakest area';
    var skillBuild = [
      'Pick your focus and record a baseline of ' + noun + '.',
      'First focused drill on ' + gap + '.',
      'Support work (fitness, theory or tools) for ' + noun + '.',
      'Learn from a pro — film or take notes, then copy one thing.',
      'Repeat the drill and compare against day 2.',
      'Pressure practice — do it under realistic conditions.',
      'Review your proof and choose next week\'s weakness.'
    ];
    var plans = {
      money_business: [
        'Define the offer and who it\'s for.',
        'Find 10 real leads.',
        'Write your outreach message.',
        'Send 5 messages.',
        'Improve the offer based on replies.',
        'Create one proof / portfolio example.',
        'Review the numbers and choose next focus.'
      ],
      business: [
        'Write your offer in one clear sentence.',
        'List 10 people who need it.',
        'Build or fix one core asset (page, profile, sample).',
        'Reach out to 5 of them.',
        'Collect feedback and sharpen the offer.',
        'Ship one visible proof of the work.',
        'Review what worked and pick next week\'s focus.'
      ],
      money_save: [
        'Set the savings target and track today\'s spending.',
        'List every fixed cost you pay.',
        'Find one expense to cut or pause.',
        'Move a set amount to savings.',
        'Plan tomorrow\'s spending in advance.',
        'A no-spend (or low-spend) day.',
        'Review the week\'s total and set next week\'s target.'
      ],
      sport: skillBuild,
      fitness: [
        'Set your baseline — one short test session.',
        'Strength / effort session A.',
        'Mobility, recovery or skill work.',
        'Strength / effort session B.',
        'Repeat session A and beat day 2.',
        'Longer or harder push session.',
        'Rest, review progress, set next week.'
      ],
      study: [
        'Find your weakest topic and test where you stand.',
        '20 focused minutes on that topic + 10 questions.',
        'Redo the questions you got wrong.',
        'New topic, same method.',
        'Mixed practice across both topics.',
        'Timed mini-test.',
        'Review mistakes and pick next week\'s topic.'
      ],
      exam: [
        'Map the syllabus and mark weak areas.',
        'Timed practice set on a weak area.',
        'Review every mistake from day 2.',
        'New section, timed practice.',
        'Full mixed practice under time.',
        'Redo the hardest questions.',
        'Review score trend and set next focus.'
      ],
      career: [
        'Define the exact role and what it requires.',
        'Build one piece of proof (portfolio / sample).',
        'Update CV / profile with today\'s work.',
        'Apply or reach out to 3 places / people.',
        'Practise one interview / core skill.',
        'Improve a weak spot from the week.',
        'Review applications and plan next steps.'
      ],
      trade: [
        'Pick the core technique to drill this week.',
        'Practise the technique slowly and safely.',
        'Study the theory / code behind it.',
        'Repeat the technique faster.',
        'Apply it on a small real task.',
        'Get feedback or compare to a pro example.',
        'Review and choose next skill.'
      ],
      content: [
        'Pick your niche and one content format.',
        'Script or outline one piece.',
        'Record / create it.',
        'Edit and publish it.',
        'Engage with 5 similar creators.',
        'Make a second piece, faster.',
        'Review what landed and plan next batch.'
      ],
      creative: [
        'Choose one small project to finish.',
        'Rough draft / sketch it.',
        'Refine the weakest part.',
        'Study one piece you admire and steal one idea.',
        'Push it toward finished.',
        'Finish and share it.',
        'Review and pick the next piece.'
      ],
      music: [
        'Pick one piece / skill and play it slowly to set a baseline.',
        'Drill the hardest bar slowly.',
        'Add a little speed; keep it clean.',
        'Work on a second section.',
        'Join the sections together.',
        'Play it through and record it.',
        'Compare to day 1 and choose next piece.'
      ],
      language: [
        'Learn 10 core words and write them in sentences.',
        'Practise listening for 10 minutes.',
        'Speak out loud — record yourself.',
        '10 new words + review yesterday\'s.',
        'Have (or simulate) one short conversation.',
        'Read a short text and note new words.',
        'Review the week\'s words and pick next focus.'
      ],
      screen_time: [
        'Check your screen-time and pick the worst app.',
        'Remove one trigger (icon, notifications, charger spot).',
        'Replace one scroll session with a real task.',
        'Set an app limit and prove a clean window.',
        'Phone out of the room for one focus block.',
        'A full evening without the worst app.',
        'Review the week\'s screen-time drop.'
      ],
      sleep: [
        'Set a fixed lights-out and wake time.',
        'No phone for 30 min before bed.',
        'Same wake time even if tired.',
        'Add a short wind-down routine.',
        'Cut late caffeine / screens.',
        'Hold the routine on a hard day.',
        'Review your sleep pattern and adjust.'
      ],
      confidence: [
        'Name the situation you avoid and why.',
        'Do one tiny version of it (say hi, ask one question).',
        'Slightly bigger rep.',
        'Prepare and deliver something short.',
        'Push into a real moment.',
        'Reflect on a win and repeat it.',
        'Review progress and set the next challenge.'
      ],
      habit: [
        'Define the habit and the exact cue / time.',
        'Do it once, on time.',
        'Remove one thing that blocks it.',
        'Do it again — stack it on an existing routine.',
        'Hold it on a busy day.',
        'Do it without reminders.',
        'Review the streak and size it up.'
      ],
      health_habit: [
        'Pick one healthy swap and your trigger for it.',
        'Do the swap once.',
        'Prep so it\'s easy tomorrow.',
        'Do it again and track it.',
        'Hold it when it\'s inconvenient.',
        'Add a second small swap.',
        'Review the week and lock the habit.'
      ],
      leadership: [
        'Pick the team / group and one thing to improve.',
        'Have one clear, direct conversation.',
        'Delegate one task instead of doing it.',
        'Give one piece of specific feedback.',
        'Make one decision and communicate the why.',
        'Handle one thing you\'d normally avoid.',
        'Review how the group responded and adjust.'
      ],
      lifestyle: [
        'Pick the one area to move first.',
        'Take one concrete action in it.',
        'Remove one thing holding you back.',
        'Repeat the action, slightly bigger.',
        'Track the change so far.',
        'Push through one hard day.',
        'Review momentum and pick next focus.'
      ],
      number_target: [
        'Log your starting number.',
        'Do one clear action toward it.',
        'Remove a blocker that slows it.',
        'Repeat the action and log again.',
        'Beat yesterday\'s number.',
        'Hold consistency on a hard day.',
        'Review the trend and set next week\'s target.'
      ],
      tech: [
        'Pick one tiny project and set it up.',
        'Build the smallest working version.',
        'Add one feature.',
        'Fix the bug that appears.',
        'Add a second feature.',
        'Clean it up and ship / share it.',
        'Review and plan the next build.'
      ],
      skill_learning: skillBuild,
      gaming: [
        'Pick the skill to improve and review a recent match.',
        'Mechanics / aim drill.',
        'Strategy / game-sense study.',
        'Apply it in ranked / practice.',
        'Review a loss and find one fix.',
        'Focused session applying the fix.',
        'Review progress and pick next weakness.'
      ],
      custom: skillBuild
    };
    return plans[pt] || skillBuild;
  }

  // short description of the daily task mix (feeds the prompt / summary)
  function dailyStrategy(profile) {
    var byType = {
      sport: 'Skill drill + support/fitness + a short review, proven daily.',
      fitness: 'A sized session + one habit anchor, proven with a photo or log.',
      study: 'Active recall + practice questions on your weakest topic.',
      exam: 'Timed practice + mistake review, paced to the exam date.',
      career: 'One proof-of-skill build + one outreach/application action.',
      trade: 'Hands-on technique reps + a little theory each day.',
      business: 'One build action + one outreach action, every day.',
      money_business: 'Daily outreach + offer sharpening, tracked by numbers.',
      money_save: 'Track spending + one saving action, proven daily.',
      content: 'Create → publish → engage, on a repeatable loop.',
      creative: 'A small finished rep daily, building to shared work.',
      music: 'Slow focused practice on the hardest part, then speed.',
      language: 'New words + real use (speaking/listening) every day.',
      screen_time: 'Replace a scroll block with a real task, proven by screen-time.',
      sleep: 'Hold a fixed rhythm + wind-down, tracked each morning.',
      confidence: 'One rep slightly outside comfort, daily.',
      habit: 'Do the habit on cue, prove it, build the streak.',
      health_habit: 'One healthy swap, repeated and tracked.',
      leadership: 'One leadership rep (conversation, decision, delegation) daily.',
      lifestyle: 'One concrete action in your chosen area, proven daily.',
      number_target: 'One action toward the number + daily logging.',
      tech: 'Ship a tiny working piece each day.',
      skill_learning: 'Focused practice reps + weekly comparison.',
      gaming: 'A mechanics or game-sense rep + match review.',
      custom: 'One concrete, provable step each day.'
    };
    return byType[profile.pathType] || byType.custom;
  }

  /* ═══════════ PROFILE BUILDER ═══════════ */
  function buildProofProfile(answers, classification) {
    var a = answers || {};
    var c = classification || classifyGoalLocal(a.goalText || '');
    var subtype = a.subtype || a.position || c.subtype || null;
    var minutes = Number(a.daily_minutes) || null;
    var intensityIdx = (typeof a.intensity === 'number') ? a.intensity : 1;
    var desiredCount = [3, 4, 5, 7][intensityIdx] || 4;
    var sportRole = c.sportRole || null;
    var goalRole = c.role;
    if (c.category === 'sport' && subtype && sportRole) {
      goalRole = cap(subtype) + ' ' + cap(sportRole.replace(/-/g, ' '));
    }
    var profile = {
      goalText: a.goalText || c.goalText || '',
      pathType: pathTypeFor(c),
      goalCategory: c.category,
      goalDomain: c.domainNoun || c.domainType || c.category,
      goalSubtype: subtype,
      goalRole: goalRole,
      sportRole: sportRole,
      domainType: c.domainType || 'general',
      domainNoun: c.domainNoun || '',
      currentLevel: a.level || null,
      mainSkillGap: a.skill_gap || null,
      obstacle: a.blocker || null,
      preferredTime: a.preferred_time || null,
      proofType: a.proof_type || 'daily proof',
      targetDeadline: a.target_deadline || null,
      goalDeadline: a.target_deadline || null,
      achievementDeadline: a.target_deadline || null,
      availableTime: minutes,
      intensityIdx: intensityIdx,
      desiredCount: desiredCount,
      answers: a
    };
    // Universal Path Graph fields — every profile gets a complete path
    profile.targetLevel = targetLevelFor(profile);
    profile.resources = resourcesFrom(a, profile);
    profile.mainBlocker = profile.obstacle || null;
    profile.dailyStrategy = dailyStrategy(profile);
    profile.firstProofTask = firstProofTask(profile);
    profile.sevenDayPlan = sevenDayPlan(profile);
    profile.onboardingSummary = summarise(profile);
    return profile;
  }

  function summarise(p) {
    var goal = cap(String(p.goalText || 'your goal').replace(/^i (want to|wanna|need to|would like to)\s*/i, '')) || 'Your goal';
    var bits = [];
    if (p.goalSubtype) bits.push(String(p.goalSubtype));
    else if (p.domainNoun && p.domainNoun !== p.goalText) bits.push(String(p.domainNoun));
    if (p.mainSkillGap) bits.push('focus: ' + p.mainSkillGap);
    if (p.availableTime) bits.push(p.availableTime + ' min/day');
    if (p.desiredCount) bits.push(p.desiredCount + ' proofs/day');
    return goal + (bits.length ? ' - ' + bits.join(', ') : '') + '.';
  }

  V.onboardingChat = {
    classifyGoalLocal: classifyGoalLocal,
    narrowNode: narrowNode,
    treeFor: treeFor,
    globalNodes: globalNodes,
    buildProofProfile: buildProofProfile,
    summarise: summarise,
    getDomainType: getDomainType,
    extractDomainNoun: extractDomainNoun,
    pathTypeFor: pathTypeFor,
    targetLevelFor: targetLevelFor,
    resourcesFrom: resourcesFrom,
    firstProofTask: firstProofTask,
    sevenDayPlan: sevenDayPlan,
    dailyStrategy: dailyStrategy,
    QUESTION_TREES: TREE_BUILDERS,
    CATEGORIES: Object.keys(TREE_BUILDERS),
    PATH_TYPES: PATH_TYPE_BY_CATEGORY
  };

})(window.VISION);
