/* ============================================================================
   VISION · Fuel Tracker  (nutrition / macros)
   ----------------------------------------------------------------------------
   Photo of food = proof of eating. An AI vision model (backend) estimates
   calories + macros; daily bars fill toward targets derived from body stats.
   Hitting the protein AND calorie targets awards XP through the server gate
   (award_nutrition_goal RPC) — meal photos are the proof, so "no photo = no XP"
   still holds. In demo mode everything runs on localStorage with a mock estimate.

   Exposed as window.VISION.nutrition.
   ========================================================================== */
window.VISION = window.VISION || {};

(function (V) {
  'use strict';

  var FUEL_KEY = 'vision_fuel_profile';

  function today() {
    try { if (V.core && V.core.today) return V.core.today(); } catch (e) {}
    try { return new Date().toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' }); }
    catch (e) { return new Date().toISOString().slice(0, 10); }
  }
  function dayKey() { return 'vision_nutrition_' + today(); }
  function lread(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } }
  function lwrite(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} return v; }
  async function live() {
    try {
      if (!(V.backend && V.sb && V.auth && V.auth.isAuthed)) return false;
      return !!(await V.auth.isAuthed());
    } catch (e) { return false; }
  }

  function dataURLtoBlob(d) {
    var a = String(d || '').split(','), m = (a[0].match(/:(.*?);/) || [null, 'image/jpeg'])[1];
    var b = atob(a[1] || ''), n = b.length, u8 = new Uint8Array(n);
    while (n--) u8[n] = b.charCodeAt(n);
    return new Blob([u8], { type: m });
  }
  async function imageToSupportedBlob(photo) {
    var blob = typeof photo === 'string' ? dataURLtoBlob(photo) : photo;
    if (!blob || typeof blob.arrayBuffer !== 'function') throw new Error('invalid_photo');
    var type = String(blob.type || '').toLowerCase();
    if (type === 'image/jpeg' || type === 'image/png' || type === 'image/webp') return blob;
    if (typeof createImageBitmap !== 'function') throw new Error('unsupported_image');
    try {
      var img = await createImageBitmap(blob);
      var ratio = Math.min(1, 4096 / Math.max(img.width, img.height));
      var w = Math.max(1, Math.round(img.width * ratio));
      var h = Math.max(1, Math.round(img.height * ratio));
      var canvas = typeof OffscreenCanvas !== 'undefined'
        ? new OffscreenCanvas(w, h)
        : (function () { var c = document.createElement('canvas'); c.width = w; c.height = h; return c; })();
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      var jpeg = typeof canvas.convertToBlob === 'function'
        ? await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.88 })
        : await new Promise(function (resolve) { canvas.toBlob(resolve, 'image/jpeg', 0.88); });
      if (img.close) img.close();
      if (!jpeg) throw new Error('image_conversion_failed');
      return jpeg;
    } catch (e) { throw new Error('unsupported_image'); }
  }
  async function secureBackendLogMeal(photo) {
    var user = await V.auth.getUser();
    if (!user || !user.id) return { error: 'not_authenticated' };
    if (!photo) return { error: 'no-photo' };
    var blob;
    try { blob = await imageToSupportedBlob(photo); }
    catch (e) { return { error: e.message || 'unsupported_image' }; }
    if (blob.size <= 0 || blob.size > 10 * 1024 * 1024) return { error: 'image_too_large' };

    var ext = blob.type === 'image/png' ? 'png' : blob.type === 'image/webp' ? 'webp' : 'jpg';
    var stamp = Date.now();
    var path = user.id + '/fuel/' + today() + '/' + stamp + '.' + ext;
    var upload = await V.sb.storage.from('proofs').upload(path, blob, {
      contentType: blob.type || 'image/jpeg', upsert: false
    });
    if (upload.error) return { error: 'upload_failed', detail: upload.error.message };

    var created = await V.sb.rpc('create_nutrition_log_v1', {
      p_date: today(), p_image_url: path
    });
    var createdData = created.data || {};
    if (created.error || createdData.ok !== true || !createdData.log_id) {
      try { await V.sb.storage.from('proofs').remove([path]); } catch (e) {}
      return { error: createdData.error || 'insert_failed', detail: created.error && created.error.message };
    }

    var logId = createdData.log_id;
    try {
      var estimated = await V.sb.functions.invoke('estimate-nutrition', { body: { log_id: logId } });
      if (estimated && estimated.data && estimated.data.meal) return { meal: estimated.data.meal };
      if (estimated && estimated.error) return { meal: { id: logId, status: 'pending' }, error: 'estimate_pending' };
    } catch (e) {}

    var row = await V.sb.from('nutrition_logs')
      .select('id,label,kcal,protein,carbs,fats,confidence,status')
      .eq('id', logId).maybeSingle();
    return { meal: row.data || { id: logId, status: 'pending' } };
  }

  function bodyStats() {
    var out = { weightKg: null, heightCm: null, age: null, sex: null, fuelGoal: null };
    function take(src) {
      if (!src) return;
      if (out.weightKg == null && (src.weightKg != null || src.weight_kg != null)) out.weightKg = src.weightKg != null ? src.weightKg : src.weight_kg;
      if (out.heightCm == null && (src.heightCm != null || src.height_cm != null)) out.heightCm = src.heightCm != null ? src.heightCm : src.height_cm;
      if (out.age == null && src.age != null) out.age = src.age;
      if (out.sex == null && src.sex) out.sex = src.sex;
      if (out.fuelGoal == null && (src.fuelGoal || src.fuel_goal)) out.fuelGoal = src.fuelGoal || src.fuel_goal;
    }
    take(lread(FUEL_KEY));
    try { var p = V.proof && V.proof.ensureProfile && V.proof.ensureProfile(); if (p) { take(p.bodyStats); take(p); } } catch (e) {}
    take(lread('vision_onboarding'));
    return out;
  }

  function goalText() {
    try {
      var ob = lread('vision_onboarding') || {};
      return (ob.goalText || ob.primaryGoal || ob.goal || localStorage.getItem('vision_main_goal') || '').toString().toLowerCase();
    } catch (e) { return ''; }
  }

  function fuelGoal() {
    var bs = bodyStats();
    if (bs.fuelGoal) return bs.fuelGoal;
    var g = goalText();
    if (/\b(lean|abs|cut|shred|lose|weight\s*loss|slim|fat\s*loss)\b/.test(g)) return 'cut';
    if (/\b(muscle|bulk|mass|gain|bigger|size|strength|stronger)\b/.test(g)) return 'bulk';
    return 'maintain';
  }

  function targets() {
    var bs = bodyStats();
    var goal = fuelGoal();
    var kcal, protein;
    if (bs.weightKg && bs.heightCm && bs.age) {
      var sexTerm = bs.sex === 'female' ? -161 : (bs.sex === 'male' ? 5 : -78);
      var bmr = 10 * bs.weightKg + 6.25 * bs.heightCm - 5 * bs.age + sexTerm;
      var tdee = bmr * 1.45;
      kcal = tdee * (goal === 'cut' ? 0.85 : goal === 'bulk' ? 1.10 : 1.0);
      protein = bs.weightKg * (goal === 'cut' ? 2.2 : goal === 'bulk' ? 2.0 : 1.8);
    } else { kcal = 2200; protein = 140; }
    kcal = Math.round(kcal); protein = Math.round(protein);
    var fats = Math.round((kcal * 0.25) / 9);
    var carbs = Math.max(0, Math.round((kcal - protein * 4 - fats * 9) / 4));
    return { kcal: kcal, protein: protein, carbs: carbs, fats: fats, goal: goal, hasStats: !!(bs.weightKg && bs.heightCm && bs.age) };
  }

  function sumMeals(meals) {
    var t = { kcal: 0, protein: 0, carbs: 0, fats: 0 };
    (meals || []).forEach(function (m) {
      t.kcal += m.kcal || 0; t.protein += m.protein || 0; t.carbs += m.carbs || 0; t.fats += m.fats || 0;
    });
    return t;
  }
  function shape(meals) {
    meals = meals || [];
    var tg = targets(), tot = sumMeals(meals);
    var pct = {
      protein: tg.protein ? Math.min(100, Math.round(tot.protein / tg.protein * 100)) : 0,
      kcal: tg.kcal ? Math.min(100, Math.round(tot.kcal / tg.kcal * 100)) : 0,
      carbs: tg.carbs ? Math.min(100, Math.round(tot.carbs / tg.carbs * 100)) : 0,
      fats: tg.fats ? Math.min(100, Math.round(tot.fats / tg.fats * 100)) : 0
    };
    var hitProtein = tot.protein >= tg.protein * 0.9;
    var hitKcal = tot.kcal >= tg.kcal * 0.9;
    return { meals: meals, totals: tot, targets: tg, pct: pct, hitProtein: hitProtein, hitKcal: hitKcal, hit: hitProtein && hitKcal };
  }

  function demoRead() { var rec = lread(dayKey()); return (rec && Array.isArray(rec.meals)) ? rec.meals : []; }
  function demoWrite(meals) { lwrite(dayKey(), { date: today(), meals: meals }); return meals; }
  function mockEstimate() {
    var n = demoRead().length;
    var bank = [
      { label: 'Chicken & rice bowl', kcal: 620, protein: 48, carbs: 65, fats: 16 },
      { label: 'Greek yogurt & berries', kcal: 240, protein: 22, carbs: 24, fats: 6 },
      { label: 'Steak & veg', kcal: 560, protein: 46, carbs: 18, fats: 32 },
      { label: 'Protein shake', kcal: 210, protein: 38, carbs: 8, fats: 3 },
      { label: 'Salmon & sweet potato', kcal: 580, protein: 42, carbs: 48, fats: 22 },
      { label: 'Eggs & toast', kcal: 410, protein: 26, carbs: 34, fats: 19 }
    ];
    return Object.assign({ confidence: 72 }, bank[n % bank.length]);
  }

  async function getToday() {
    if ((await live()) && V.api && typeof V.api.getNutritionToday === 'function') {
      try { var r = await V.api.getNutritionToday(today()); if (r && Array.isArray(r.meals)) return shape(r.meals); } catch (e) {}
    }
    return shape(demoRead());
  }
  function getTodayLocal() { return shape(demoRead()); }

  async function logMeal(photo) {
    var awardResult = null;
    if (await live()) {
      var r = await secureBackendLogMeal(photo);
      if (!r || (r.error && !r.meal)) return { error: (r && r.error) || 'log_failed' };
      var meal = r.meal || r;
      var estimated = meal && meal.status === 'estimated';
      var state = await getToday();
      if (estimated && state.hit && V.api && V.api.awardNutritionGoal) {
        try { awardResult = await V.api.awardNutritionGoal(today()); } catch (e) {}
      }
      return { meal: meal, state: state, awardResult: awardResult };
    }

    var est = mockEstimate();
    var meal = {
      id: 'm' + Date.now(), label: est.label || 'Meal', kcal: est.kcal || 0,
      protein: est.protein || 0, carbs: est.carbs || 0, fats: est.fats || 0,
      confidence: est.confidence || 70, status: 'estimated',
      img: (typeof photo === 'string') ? photo : null, ts: Date.now()
    };
    var meals = demoRead(); meals.push(meal); demoWrite(meals);
    var st = shape(meals);
    if (st.hit && !lread(dayKey() + '_awarded')) {
      lwrite(dayKey() + '_awarded', true);
      awardResult = { status: 'awarded', awarded: true, earned_xp: 50 };
    }
    return { meal: meal, state: st, awardResult: awardResult };
  }

  async function estimate(photo) {
    if ((await live()) && V.api && typeof V.api.estimateMeal === 'function') {
      var r = await V.api.estimateMeal(photo);
      if (r && !r.error) return r;
      throw new Error((r && r.error) || 'estimate_failed');
    }
    return mockEstimate();
  }

  async function setFuelProfile(stats) {
    var cur = lread(FUEL_KEY) || {};
    var merged = Object.assign(cur, stats || {});
    lwrite(FUEL_KEY, merged);
    if ((await live()) && V.api && typeof V.api.setFuelProfile === 'function') {
      try { await V.api.setFuelProfile(merged); } catch (e) {}
    }
    return merged;
  }

  function isFitnessUser() {
    try { var path = V.proof && V.proof.pathOf ? V.proof.pathOf() : ''; if (path === 'fitness' || path === 'athlete') return true; } catch (e) {}
    try { var ob = lread('vision_onboarding') || {}; if (ob.fitnessIncluded) return true; } catch (e) {}
    var g = goalText();
    return /\b(gym|muscle|muscular|fitness|fit|lean|shred|tone|physique|weight|abs|protein|workout|exercise|train|body|diet|nutrition|calorie|macro|strength|strong|run|jog|marathon|cardio|endurance|athlet|sport|bulk|cut)/.test(g);
  }

  V.nutrition = {
    today: getToday, todayLocal: getTodayLocal,
    targets: targets, bodyStats: bodyStats, fuelGoal: fuelGoal,
    logMeal: logMeal, estimate: estimate, setFuelProfile: setFuelProfile,
    isFitnessUser: isFitnessUser, shape: shape
  };
})(window.VISION);
