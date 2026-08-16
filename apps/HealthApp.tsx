import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { useOS } from '../context/OSContext';
import { CaretLeft, CaretRight, Plus, X, Drop, PencilSimple, Trash, ArrowClockwise, Camera, Gear, Barbell, MoonStars, ForkKnife, Bandaids, CalendarBlank, ChartLineUp } from '@phosphor-icons/react';
import {
  HealthEvent, WorkoutHealthEvent, PeriodHealthEvent, SymptomHealthEvent,
  SleepHealthEvent, DietHealthEvent, WeightHealthEvent,
  PeriodFlow, SleepQuality,
  saveHealthEvent, deleteHealthEvent, getAllHealthEvents, buildEventMap,
} from '../utils/healthDb';
import { calcCycleStatus } from '../utils/cycleCalc';
import { F, S, R, HUE, STATUS, MOTION } from '../utils/clayTokens';
import { HealthProfile, FitnessGoal, getHealthProfile, saveHealthProfile, calcBMR, calcTDEE, recommendCalories, calcDeficit } from '../utils/healthProfile';
import { safeFetchJson, extractJson, extractContent } from '../utils/safeApi';
import { readLiliumOSStorage, writeLiliumOSStorage } from '../utils/liliumosStorage';

// ── Constants ──────────────────────────────────────────────────────────────────

const FLOW_DOT: Record<PeriodFlow, React.CSSProperties> = {
  heavy:    { background: HUE.red.main },
  medium:   { background: HUE.rose.main },
  light:    { background: HUE.rose.soft },
  spotting: { background: HUE.rose.tint, border: `1px solid ${HUE.rose.soft}` },
};
const FLOW_LABEL: Record<PeriodFlow, string> = {
  heavy: '量多', medium: '量中', light: '量少', spotting: '点滴',
};
const QUALITY_LABEL: Record<SleepQuality, string> = { good: '很好', ok: '还行', poor: '不太好' };
const MONTH_NAMES = ['一月','二月','三月','四月','五月','六月','七月','八月','九月','十月','十一月','十二月'];
const WEEKDAYS    = ['日','一','二','三','四','五','六'];

const toDateStr = (y: number, m: number, d: number) =>
  `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/** 在两个 #RRGGBB 颜色之间线性插值 */
function lerpColor(from: string, to: string, t: number): string {
  const a = parseInt(from.slice(1), 16), b = parseInt(to.slice(1), 16);
  const ch = (shift: number) => {
    const x = (a >> shift) & 255, y = (b >> shift) & 255;
    return Math.round(x + (y - x) * t);
  };
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0')}`;
}

type RecordMode = 'workout' | 'period' | 'symptom' | 'sleep' | 'diet';
type TopTab = 'calendar' | 'today';

// ── Category color system ──────────────────────────────────────────────────────

const CAT_COLORS = {
  workout: { bg: HUE.green.tint, fg: HUE.green.ink,   active: HUE.green.main,  border: HUE.green.tint,  shadow: HUE.green.ink },
  sleep:   { bg: HUE.blue.tint,  fg: HUE.blue.ink,    active: HUE.blue.main,   border: HUE.blue.tint,   shadow: HUE.blue.ink },
  diet:    { bg: HUE.amber.tint, fg: HUE.amber.ink,   active: HUE.amber.main,  border: HUE.amber.tint,  shadow: HUE.amber.ink },
  period:  { bg: HUE.rose.tint,  fg: HUE.rose.ink,    active: HUE.rose.main,   border: HUE.rose.tint,   shadow: HUE.rose.ink },
  symptom: { bg: HUE.purple.tint,fg: HUE.purple.ink,  active: HUE.purple.main, border: HUE.purple.tint, shadow: HUE.purple.ink },
} as const;

const MACRO_COLORS = {
  protein: HUE.teal.ink,
  carbs:   HUE.amber.ink,
  fat:     HUE.orange.main,
} as const;

const TAB_ORDER: { id: RecordMode; label: string }[] = [
  { id: 'workout', label: '训练' },
  { id: 'sleep',   label: '睡眠' },
  { id: 'diet',    label: '饮食' },
  { id: 'period',  label: '经期' },
  { id: 'symptom', label: '症状' },
];

const WORKOUT_ACTIVITIES = ['力量', '跑步', '走路', '游泳', '骑行', '球类', '瑜伽/拉伸', '操课/有氧', '爬山', '其他'];
const WORKOUT_PARTS = ['胸', '背', '腿', '臀', '肩', '手臂', '核心', '全身'];

// 症状分两组：经期伴随症状记在经期 tab，身体不适记在症状 tab；存储时合并进同一条 symptom 记录
// 注意两组不能有重复项（保存时按组归属做合并）
const PMS_SYMPTOMS     = ['痛经', '乳房胀痛', '腰酸', '腹胀', '情绪波动', '长痘', '食欲增加'];
const GENERAL_SYMPTOMS = ['头痛', '感冒', '发烧', '胃痛', '恶心', '失眠', '过敏', '疲劳'];

// 弹窗高度：默认 420px；训练/饮食可拖到屏幕 85%
const MODAL_BASE_H = 420;

// ── 饮食草稿（按日期存 localStorage，白天随手记、晚上一次结算） ──────────────
const DIET_DRAFT_KEY = 'liliumos_diet_draft';
const LEGACY_DIET_DRAFT_KEYS = ['sullyem_diet_draft'];

function loadDietDraft(date: string): string {
  try {
    const m = JSON.parse(readLiliumOSStorage(DIET_DRAFT_KEY, LEGACY_DIET_DRAFT_KEYS) || '{}');
    return typeof m[date] === 'string' ? m[date] : '';
  } catch { return ''; }
}

function saveDietDraft(date: string, text: string): void {
  try {
    const m = JSON.parse(readLiliumOSStorage(DIET_DRAFT_KEY, LEGACY_DIET_DRAFT_KEYS) || '{}');
    if (text.trim()) m[date] = text; else delete m[date];
    // 清理 7 天前的旧草稿（日期字符串 YYYY-MM-DD 可直接比较）
    const cutoff = new Date(Date.now() - 7 * 86400000);
    const cutoffStr = toDateStr(cutoff.getFullYear(), cutoff.getMonth() + 1, cutoff.getDate());
    for (const k of Object.keys(m)) if (k < cutoffStr) delete m[k];
    writeLiliumOSStorage(DIET_DRAFT_KEY, JSON.stringify(m), LEGACY_DIET_DRAFT_KEYS);
  } catch {}
}

// ── LLM parsers ───────────────────────────────────────────────────────────────

interface ParsedDiet {
  calories: number; protein?: number; carbs?: number; fat?: number; fiber?: number;
}

/** 文字估算。失败时 throw 带具体原因的 Error（手机端无控制台，靠 toast 展示） */
async function parseDietText(text: string, apiBase: string, apiKey: string, model: string): Promise<ParsedDiet> {
  const systemPrompt = `你是一个营养估算助手。根据用户描述的饮食内容，估算营养数据并以 JSON 格式返回：
- calories: 总热量 kcal（整数）
- protein: 蛋白质 g（整数）
- carbs: 碳水化合物 g（整数）
- fat: 脂肪 g（整数）
- fiber: 膳食纤维 g（整数）
尽可能准确估算中国家常菜的营养成分。只返回 JSON，不要解释。`;
  const base = apiBase.replace(/\/+$/, '');
  const data = await safeFetchJson(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey || 'sk-none'}` },
    // max_tokens 要给足：Gemini 等 thinking 模型的思考过程也算在内，给少了正文直接为空
    body: JSON.stringify({ model, messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: text }], temperature: 0.2, max_tokens: 4000, stream: false }),
  });
  const raw = extractContent(data);
  if (!raw) throw new Error(`AI返回空内容（finish: ${data?.choices?.[0]?.finish_reason ?? '?'}）`);
  const parsed = extractJson(raw);
  if (!parsed) throw new Error(`返回内容无法解析: ${raw.slice(0, 60)}`);
  return parsed as ParsedDiet;
}

interface ParsedDietImage extends ParsedDiet {
  description?: string;
}

/** 拍照识图：base64 图片 → vision 模型估算营养（OpenAI 兼容 image_url 格式，Gemini 等支持）。失败时 throw */
async function parseDietImage(imageDataUrl: string, apiBase: string, apiKey: string, model: string): Promise<ParsedDietImage> {
  const systemPrompt = `你是一个营养估算助手。识别图片中的食物，估算营养数据并以 JSON 格式返回：
- description: 食物清单简述（如"红烧肉半份、白米饭一碗"，最多50字）
- calories: 总热量 kcal（整数）
- protein: 蛋白质 g（整数）
- carbs: 碳水化合物 g（整数）
- fat: 脂肪 g（整数）
- fiber: 膳食纤维 g（整数）
根据图中份量尽可能准确估算，中国家常菜按常见做法估。只返回 JSON，不要解释。`;
  const base = apiBase.replace(/\/+$/, '');
  const data = await safeFetchJson(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey || 'sk-none'}` },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: [
          { type: 'image_url', image_url: { url: imageDataUrl } },
          { type: 'text', text: '识别这张图里的食物并估算营养。' },
        ] },
      ],
      temperature: 0.2, max_tokens: 4000, stream: false,
    }),
  });
  const raw = extractContent(data);
  if (!raw) throw new Error(`AI返回空内容（finish: ${data?.choices?.[0]?.finish_reason ?? '?'}）`);
  const parsed = extractJson(raw);
  if (!parsed) throw new Error(`返回内容无法解析: ${raw.slice(0, 60)}`);
  return parsed as ParsedDietImage;
}

/** 压缩图片到最长边 1024px 的 JPEG data URL，控制 base64 体积 */
function compressImage(file: File, maxDim = 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext('2d');
      if (!ctx) { reject(new Error('canvas unavailable')); return; }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('image load failed')); };
    img.src = url;
  });
}

// ── Sleep duration helper ─────────────────────────────────────────────────────

function calcSleepMinutes(bedtime: string, wakeTime: string): number {
  const [bh, bm] = bedtime.split(':').map(Number);
  const [wh, wm] = wakeTime.split(':').map(Number);
  let mins = (wh * 60 + wm) - (bh * 60 + bm);
  if (mins <= 0) mins += 24 * 60; // 跨午夜
  return mins;
}

function fmtDuration(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h${m}m` : `${h}h`;
}

// ── Component ──────────────────────────────────────────────────────────────────

const HealthApp: React.FC = () => {
  const { closeApp, addToast, apiConfig } = useOS();

  const today    = new Date();
  const todayStr = toDateStr(today.getFullYear(), today.getMonth() + 1, today.getDate());

  // ── Top-level tab ──
  const [topTab, setTopTab] = useState<TopTab>('calendar');

  // ── Calendar navigation ──
  const [viewYear,  setViewYear]  = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth() + 1);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [todayViewOffset, setTodayViewOffset] = useState(0);
  const [showDatePicker, setShowDatePicker] = useState(false);

  // ── Data ──
  const [allEvents, setAllEvents] = useState<HealthEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // ── Record modal ──
  const [recordMode, setRecordMode] = useState<RecordMode | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  // Workout
  const [recordText, setRecordText] = useState('');
  // Period / symptom
  const [periodFlow, setPeriodFlow] = useState<PeriodFlow | null>(null);
  const [periodSymptoms, setPeriodSymptoms] = useState<string[]>([]); // 症状 tab：身体不适
  const [pmsSymptoms, setPmsSymptoms] = useState<string[]>([]);       // 经期 tab：伴随症状
  const [periodDate, setPeriodDate] = useState(todayStr);
  // Sleep
  const [sleepBedtime, setSleepBedtime]   = useState('23:00');
  const [sleepWakeTime, setSleepWakeTime] = useState('07:30');
  const [sleepQuality, setSleepQuality]   = useState<SleepQuality>('good');
  const [sleepNote, setSleepNote]         = useState('');
  // Diet
  const [dietText, setDietText]         = useState('');
  const [dietCalories, setDietCalories] = useState<number | ''>('');
  const [dietProtein, setDietProtein]   = useState<number | ''>('');
  const [dietCarbs, setDietCarbs]       = useState<number | ''>('');
  const [dietFat, setDietFat]           = useState<number | ''>('');
  const [dietFiber, setDietFiber]       = useState<number | ''>('');
  const [dietNote, setDietNote]         = useState('');
  const [dietParsed, setDietParsed]     = useState(false);
  // Workout direct input
  const [workoutCalories, setWorkoutCalories] = useState<number | ''>('');
  const [workoutDuration, setWorkoutDuration] = useState<number | ''>(60);
  const [workoutParts, setWorkoutParts] = useState<string[]>([]);
  const [workoutActivities, setWorkoutActivities] = useState<string[]>([]);
  // Camera menu
  const [showCameraMenu, setShowCameraMenu] = useState(false);
  // Modal height drag（训练/饮食可拖高）
  const [modalHeight, setModalHeight] = useState(MODAL_BASE_H);
  const [isDraggingModal, setIsDraggingModal] = useState(false);
  const modalDragRef = React.useRef({ startY: 0, startH: MODAL_BASE_H, maxH: 700 });
  // Health profile + weight trend
  const [profile, setProfile] = useState<HealthProfile | null>(null);
  const [showProfileSetup, setShowProfileSetup] = useState(false);
  const [showWeightTrend, setShowWeightTrend] = useState(false);
  // Profile form fields
  const [pfHeight, setPfHeight] = useState<number | ''>('');
  const [pfWeight, setPfWeight] = useState<number | ''>('');
  const [pfAge, setPfAge]       = useState<number | ''>('');
  const [pfSex, setPfSex]       = useState<'F' | 'M'>('F');
  const [pfBf, setPfBf]         = useState<number | ''>('');
  const [pfGoal, setPfGoal]     = useState<FitnessGoal>('maintain');
  const [pfCalTarget, setPfCalTarget]       = useState<number | ''>('');
  const [pfWorkoutTarget, setPfWorkoutTarget] = useState<number | ''>(500);
  const [pfSleepTarget, setPfSleepTarget]   = useState<number | ''>(8);

  // ── Load data ──
  const loadEvents = useCallback(async () => {
    setIsLoading(true);
    try { setAllEvents(await getAllHealthEvents()); }
    catch (err) { console.error('[HealthApp] Failed to load events:', err); }
    finally { setIsLoading(false); }
  }, []);

  useEffect(() => { loadEvents(); }, [loadEvents]);

  // ── Load profile ──
  useEffect(() => {
    const p = getHealthProfile();
    setProfile(p);
    if (!p) setShowProfileSetup(true); // 第一次打开时弹设置
  }, []);

  // ── Derived data ──
  const eventMap     = useMemo(() => buildEventMap(allEvents), [allEvents]);
  const periodEvents = useMemo(() => allEvents.filter((e): e is PeriodHealthEvent => e.type === 'period'), [allEvents]);
  const cycleStatus  = useMemo(() => calcCycleStatus(periodEvents), [periodEvents]);
  const ovulationSet = useMemo(() => new Set(cycleStatus.ovulationWindow), [cycleStatus.ovulationWindow]);

  // ── Today tab viewed date (arrow navigation) ──
  const viewDay = new Date(today);
  viewDay.setDate(viewDay.getDate() + todayViewOffset);
  const viewDayStr = toDateStr(viewDay.getFullYear(), viewDay.getMonth() + 1, viewDay.getDate());
  const pickerYear = viewDay.getFullYear();
  const pickerMonth = viewDay.getMonth() + 1;
  const pickerFirstDow = new Date(pickerYear, pickerMonth - 1, 1).getDay();
  const pickerDaysInMonth = new Date(pickerYear, pickerMonth, 0).getDate();
  const pickerCells = Array.from({ length: pickerFirstDow }, () => 0).concat(Array.from({ length: pickerDaysInMonth }, (_, i) => i + 1));

  // ── Today's events (uses viewed date) ──
  const todayEvents = useMemo(() => eventMap[viewDayStr] || [], [eventMap, viewDayStr]);
  const todayWorkout = todayEvents.find(e => e.type === 'workout') as WorkoutHealthEvent | undefined;
  const todaySleep   = todayEvents.find(e => e.type === 'sleep')   as SleepHealthEvent   | undefined;
  const todayDiets   = todayEvents.filter(e => e.type === 'diet')  as DietHealthEvent[];
  const todayDietTotal = todayDiets.reduce((s, d) => s + d.calories, 0);
  const dietProteinKcal = todayDiets.reduce((s, d) => s + (d.protein ?? 0), 0) * 4;
  const dietCarbsKcal   = todayDiets.reduce((s, d) => s + (d.carbs ?? 0), 0) * 4;
  const dietFatKcal     = todayDiets.reduce((s, d) => s + (d.fat ?? 0), 0) * 9;
  const dietHasMacros   = dietProteinKcal + dietCarbsKcal + dietFatKcal > 0;
  const todayPeriod  = todayEvents.find(e => e.type === 'period')  as PeriodHealthEvent  | undefined;
  const todaySymptom = todayEvents.find(e => e.type === 'symptom') as SymptomHealthEvent | undefined;
  // Weight always uses actual today for recording
  const todayWeight = (eventMap[todayStr] || []).find(e => e.type === 'weight') as WeightHealthEvent | undefined;

  // ── BMR, targets & deficit ──
  const bmr = useMemo(() => profile ? calcBMR(profile) : 0, [profile]);
  const calTarget      = profile?.dailyCalorieTarget ?? (bmr ? calcTDEE(bmr) : 2000);
  const workoutTarget  = profile?.workoutCalorieTarget ?? 500;
  const sleepTarget    = profile?.sleepMinuteTarget ?? 480;
  const exerciseCal = todayWorkout?.calories ?? 0;
  const deficit = calTarget ? calcDeficit(calTarget, exerciseCal, todayDietTotal) : null;

  // ── Weight history (last 30 entries) ──
  const weightHistory = useMemo(() =>
    allEvents
      .filter((e): e is WeightHealthEvent => e.type === 'weight')
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-30),
    [allEvents]
  );

  // ── Calendar grid ──
  const calendarDays = useMemo(() => {
    const firstDay    = new Date(viewYear, viewMonth - 1, 1).getDay();
    const daysInMonth = new Date(viewYear, viewMonth, 0).getDate();
    const cells: (number | null)[] = [];
    for (let i = 0; i < firstDay; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(d);
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  }, [viewYear, viewMonth]);

  const prevMonth = () => { if (viewMonth === 1) { setViewYear(y => y - 1); setViewMonth(12); } else setViewMonth(m => m - 1); };
  const nextMonth = () => { if (viewMonth === 12) { setViewYear(y => y + 1); setViewMonth(1); } else setViewMonth(m => m + 1); };

  // ── Selected day ──
  const selectedEvents = selectedDate ? (eventMap[selectedDate] || []) : [];
  const selWorkout = selectedEvents.find(e => e.type === 'workout') as WorkoutHealthEvent | undefined;
  const selPeriod  = selectedEvents.find(e => e.type === 'period')  as PeriodHealthEvent  | undefined;
  const selSymptom = selectedEvents.find(e => e.type === 'symptom') as SymptomHealthEvent | undefined;
  const selSleep   = selectedEvents.find(e => e.type === 'sleep')   as SleepHealthEvent   | undefined;
  const selDiet    = selectedEvents.filter(e => e.type === 'diet')   as DietHealthEvent[];

  // ── Modal close / reset ──
  const closeRecord = () => {
    setRecordMode(null); setRecordText(''); setPeriodFlow(null);
    setPeriodSymptoms([]); setPmsSymptoms([]); setPeriodDate(todayStr); setEditingId(null);
    setSleepBedtime('23:00'); setSleepWakeTime('07:30');
    setSleepQuality('good'); setSleepNote('');
    setDietText(''); setDietCalories(''); setDietProtein('');
    setDietCarbs(''); setDietFat(''); setDietFiber('');
    setDietNote(''); setDietParsed(false);
    setWorkoutCalories(''); setWorkoutDuration(60); setWorkoutParts([]); setWorkoutActivities([]);
    setShowCameraMenu(false);
    setModalHeight(MODAL_BASE_H);
  };

  // ── Submit: Workout ──
  const handleSubmitWorkout = async () => {
    if ((workoutActivities.length === 0 && !recordText.trim() && !workoutCalories) || isSubmitting) return;
    setIsSubmitting(true);
    try {
      // summary 供角色读取："力量（背+腿）+跑步" 或备注摘要
      const actLabel = workoutActivities.map(a =>
        a === '力量' && workoutParts.length > 0 ? `力量（${workoutParts.join('+')}）` : a
      ).join('+');
      const event: WorkoutHealthEvent = {
        id: editingId ?? `workout_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        date: periodDate, createdAt: Date.now(), type: 'workout',
        activities: workoutActivities,
        parts: workoutParts, duration: workoutDuration ? Number(workoutDuration) : 60,
        calories: workoutCalories ? Number(workoutCalories) : undefined,
        summary: actLabel || (recordText.trim() ? recordText.slice(0, 80) : '训练'),
        rawInput: recordText,
      };
      await saveHealthEvent(event); await loadEvents(); closeRecord();
      addToast(editingId ? '训练记录已更新' : '训练记录已保存', 'success');
    } catch { addToast('保存失败，请重试', 'error'); }
    finally { setIsSubmitting(false); }
  };

  // ── Symptom merge helper ──────────────────────────────────────────────────
  // 经期 tab 和症状 tab 各管一组症状，保存时合并进同一条 symptom 记录：
  // 先剔除本组旧值、保留对方组的，再并入本次选择。全空则删除记录。
  const saveSymptomGroup = async (groupList: string[], selected: string[]) => {
    const existing = (eventMap[periodDate] || []).find(e => e.type === 'symptom') as SymptomHealthEvent | undefined;
    const others = (existing?.symptoms ?? []).filter(s => !groupList.includes(s));
    const merged = [...others, ...selected];
    if (merged.length > 0) {
      await saveHealthEvent({
        id: existing?.id ?? `symptom_${periodDate}_${Math.random().toString(36).slice(2, 7)}`,
        date: periodDate, createdAt: existing?.createdAt ?? Date.now(), type: 'symptom', symptoms: merged,
      } as SymptomHealthEvent);
    } else if (existing) {
      await deleteHealthEvent(existing.id);
    }
  };

  // ── Submit: Period（量级 + 伴随症状，至少其一；PMS 可在出血前单独记） ──
  const handleSubmitPeriod = async () => {
    if (!periodFlow && pmsSymptoms.length === 0) return;
    setIsSubmitting(true);
    try {
      if (periodFlow) {
        const event: PeriodHealthEvent = {
          id: editingId ?? `period_${periodDate}_${Math.random().toString(36).slice(2, 7)}`,
          date: periodDate, createdAt: Date.now(), type: 'period', flow: periodFlow,
        };
        await saveHealthEvent(event);
      }
      await saveSymptomGroup(PMS_SYMPTOMS, pmsSymptoms);
      await loadEvents(); closeRecord();
      addToast('已保存', 'success');
    } catch { addToast('保存失败，请重试', 'error'); }
    finally { setIsSubmitting(false); }
  };

  // ── Submit: Symptom（身体不适） ──
  const handleSubmitSymptom = async () => {
    if (periodSymptoms.length === 0 && !editingId) return;
    setIsSubmitting(true);
    try {
      await saveSymptomGroup(GENERAL_SYMPTOMS, periodSymptoms);
      await loadEvents(); closeRecord();
      addToast(editingId ? '症状记录已更新' : '症状已保存', 'success');
    } catch { addToast('保存失败，请重试', 'error'); }
    finally { setIsSubmitting(false); }
  };

  // ── Submit: Sleep ──
  const handleSubmitSleep = async () => {
    setIsSubmitting(true);
    try {
      const dur = calcSleepMinutes(sleepBedtime, sleepWakeTime);
      const event: SleepHealthEvent = {
        id: editingId ?? `sleep_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        date: periodDate, createdAt: Date.now(), type: 'sleep',
        bedtime: sleepBedtime, wakeTime: sleepWakeTime,
        duration: dur, quality: sleepQuality,
        note: sleepNote || undefined,
      };
      await saveHealthEvent(event); await loadEvents(); closeRecord();
      addToast(editingId ? '睡眠记录已更新' : '睡眠记录已保存', 'success');
    } catch { addToast('保存失败，请重试', 'error'); }
    finally { setIsSubmitting(false); }
  };

  // ── Submit: Diet ──
  const handleSubmitDiet = async () => {
    if (!dietCalories) return;
    setIsSubmitting(true);
    try {
      const event: DietHealthEvent = {
        id: editingId ?? `diet_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        date: periodDate, createdAt: Date.now(), type: 'diet',
        calories: Number(dietCalories),
        protein: dietProtein ? Number(dietProtein) : undefined,
        carbs: dietCarbs ? Number(dietCarbs) : undefined,
        fat: dietFat ? Number(dietFat) : undefined,
        fiber: dietFiber ? Number(dietFiber) : undefined,
        rawInput: dietText || undefined,
        note: dietNote || undefined,
      };
      await saveHealthEvent(event); await loadEvents();
      saveDietDraft(periodDate, ''); // 已结算，清掉当天草稿
      closeRecord();
      addToast(editingId ? '饮食记录已更新' : '饮食记录已保存', 'success');
    } catch { addToast('保存失败，请重试', 'error'); }
    finally { setIsSubmitting(false); }
  };

  // ── AI Diet Estimate ──
  const handleDietEstimate = async () => {
    if (!dietText.trim() || isSubmitting) return;
    if (!apiConfig?.baseUrl || !apiConfig?.model) { addToast('请先配置 API', 'error'); return; }
    setIsSubmitting(true);
    try {
      const parsed = await parseDietText(dietText, apiConfig.baseUrl, apiConfig.apiKey, apiConfig.model);
      setDietCalories(parsed.calories);
      if (parsed.protein != null) setDietProtein(parsed.protein);
      if (parsed.carbs != null)   setDietCarbs(parsed.carbs);
      if (parsed.fat != null)     setDietFat(parsed.fat);
      if (parsed.fiber != null)   setDietFiber(parsed.fiber);
      setDietParsed(true);
    } catch (err: any) {
      console.warn('[handleDietEstimate]', err);
      addToast(`估算失败: ${String(err?.message ?? err).slice(0, 120)}`, 'error');
    }
    finally { setIsSubmitting(false); }
  };

  // ── Image input handler (camera menu) ──
  const handleImageInput = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // 允许重复选择同一张图
    if (!file) return;
    setShowCameraMenu(false);
    if (!file.type.startsWith('image/')) { addToast('请选择图片文件', 'error'); return; }
    if (!apiConfig?.baseUrl || !apiConfig?.model) { addToast('请先配置 API', 'error'); return; }
    setIsSubmitting(true);
    try {
      const dataUrl = await compressImage(file);
      const parsed = await parseDietImage(dataUrl, apiConfig.baseUrl, apiConfig.apiKey, apiConfig.model);
      const hadText = dietText.trim().length > 0;
      if (parsed.description) {
        // 已有草稿时追加而不是覆盖（白天多次拍照累积）
        const newText = hadText ? `${dietText.trim()}\n${parsed.description}` : parsed.description;
        setDietText(newText);
        if (!editingId) saveDietDraft(periodDate, newText);
      }
      if (hadText) {
        // 营养数据只是这一张图的量，提示重新估算全天
        addToast('已追加到描述，点 AI 估算算全天总量', 'info');
        setDietParsed(false);
      } else {
        setDietCalories(parsed.calories);
        if (parsed.protein != null) setDietProtein(parsed.protein);
        if (parsed.carbs != null)   setDietCarbs(parsed.carbs);
        if (parsed.fat != null)     setDietFat(parsed.fat);
        if (parsed.fiber != null)   setDietFiber(parsed.fiber);
        setDietParsed(true);
      }
    } catch (err: any) {
      console.warn('[handleImageInput]', err);
      addToast(`识图失败: ${String(err?.message ?? err).slice(0, 120)}`, 'error');
    }
    finally { setIsSubmitting(false); }
  };

  // ── Save profile ──
  const handleSaveProfile = () => {
    if (!pfHeight || !pfWeight || !pfAge) { addToast('请填写身高体重年龄', 'error'); return; }
    const bmrVal = calcBMR({ heightCm: Number(pfHeight), weightKg: Number(pfWeight), age: Number(pfAge), sex: pfSex, bodyFatPct: pfBf ? Number(pfBf) : undefined });
    const autoTarget = recommendCalories(bmrVal, pfGoal);
    const p: HealthProfile = {
      heightCm: Number(pfHeight), weightKg: Number(pfWeight), age: Number(pfAge), sex: pfSex,
      bodyFatPct: pfBf ? Number(pfBf) : undefined,
      goal: pfGoal,
      dailyCalorieTarget: pfCalTarget ? Number(pfCalTarget) : autoTarget,
      workoutCalorieTarget: pfWorkoutTarget ? Number(pfWorkoutTarget) : 500,
      sleepMinuteTarget: pfSleepTarget ? Number(pfSleepTarget) * 60 : 480,
    };
    saveHealthProfile(p);
    setProfile(p);
    setShowProfileSetup(false);
    addToast(`BMR ${bmrVal} · 目标 ${p.dailyCalorieTarget} kcal/天`, 'success');
  };

  const openProfileSetup = () => {
    if (profile) {
      setPfHeight(profile.heightCm); setPfWeight(profile.weightKg); setPfAge(profile.age); setPfSex(profile.sex); setPfBf(profile.bodyFatPct ?? '');
      setPfGoal(profile.goal ?? 'maintain');
      setPfCalTarget(profile.dailyCalorieTarget ?? '');
      setPfWorkoutTarget(profile.workoutCalorieTarget ?? 500);
      setPfSleepTarget(profile.sleepMinuteTarget ? profile.sleepMinuteTarget / 60 : 8);
    }
    setShowProfileSetup(true);
  };

  // ── Quick weight save ──
  const handleSaveWeight = async (value: number) => {
    const existing = todayWeight;
    const event: WeightHealthEvent = {
      id: existing?.id ?? `weight_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      date: todayStr, createdAt: Date.now(), type: 'weight', value,
    };
    await saveHealthEvent(event);
    await loadEvents();
    addToast(`体重 ${value}kg 已记录`, 'success');
  };

  // ── Delete ──
  const handleDelete = async (id: string, label: string) => {
    try { await deleteHealthEvent(id); await loadEvents(); addToast(`${label}已删除`, 'success'); }
    catch { addToast('删除失败', 'error'); }
  };

  // ── Edit helpers ──
  // 注意：必须 setPeriodDate(记录日期)，否则跨天编辑时保存会把记录改写到"今天"
  const startEditWorkout = (w: WorkoutHealthEvent) => { setEditingId(w.id); setRecordText(w.rawInput ?? ''); setWorkoutCalories(w.calories ?? ''); setWorkoutDuration(w.duration); setWorkoutParts(w.parts); setWorkoutActivities(w.activities ?? []); setSelectedDate(w.date); setPeriodDate(w.date); setRecordMode('workout'); };
  const startEditPeriod  = (p: PeriodHealthEvent)  => {
    setEditingId(p.id); setPeriodFlow(p.flow); setPeriodDate(p.date);
    const sym = (eventMap[p.date] || []).find(e => e.type === 'symptom') as SymptomHealthEvent | undefined;
    setPmsSymptoms((sym?.symptoms ?? []).filter(s => PMS_SYMPTOMS.includes(s)));
    setRecordMode('period');
  };
  const startEditSymptom = (s: SymptomHealthEvent) => { setEditingId(s.id); setPeriodSymptoms(s.symptoms.filter(x => GENERAL_SYMPTOMS.includes(x))); setPeriodDate(s.date); setRecordMode('symptom'); };
  const startEditSleep   = (s: SleepHealthEvent)   => { setEditingId(s.id); setSleepBedtime(s.bedtime); setSleepWakeTime(s.wakeTime); setSleepQuality(s.quality); setSleepNote(s.note ?? ''); setPeriodDate(s.date); setRecordMode('sleep'); };
  const startEditDiet    = (d: DietHealthEvent)     => { setEditingId(d.id); setDietCalories(d.calories); setDietProtein(d.protein ?? ''); setDietCarbs(d.carbs ?? ''); setDietFat(d.fat ?? ''); setDietFiber(d.fiber ?? ''); setDietText(d.rawInput ?? ''); setDietNote(d.note ?? ''); setDietParsed(true); setPeriodDate(d.date); setRecordMode('diet'); };

  const toggleSymptom = (sym: string) =>
    setPeriodSymptoms(prev => prev.includes(sym) ? prev.filter(x => x !== sym) : [...prev, sym]);

  const openRecord = (mode: RecordMode) => {
    // Reset all form fields first
    setEditingId(null);
    setRecordText(''); setWorkoutCalories(''); setWorkoutDuration(60); setWorkoutParts([]); setWorkoutActivities([]);
    // 简单类型固定 420 高；训练/饮食保留当前拖拽高度
    if (mode !== 'workout' && mode !== 'diet') setModalHeight(MODAL_BASE_H);
    setPeriodFlow(null); setPeriodSymptoms([]); setPmsSymptoms([]);
    setSleepBedtime('23:00'); setSleepWakeTime('07:30'); setSleepQuality('good'); setSleepNote('');
    setDietText(''); setDietCalories(''); setDietProtein(''); setDietCarbs(''); setDietFat(''); setDietFiber(''); setDietNote(''); setDietParsed(false);
    setShowCameraMenu(false);

    const dateStr = topTab === 'today' ? viewDayStr : (selectedDate ?? todayStr);
    setPeriodDate(dateStr);
    const dayEvents = eventMap[dateStr] || [];

    // Auto-load existing record for this day (+ and edit share the same entry)
    switch (mode) {
      case 'workout': {
        const w = dayEvents.find(e => e.type === 'workout') as WorkoutHealthEvent | undefined;
        if (w) { setEditingId(w.id); setRecordText(w.rawInput ?? ''); setWorkoutCalories(w.calories ?? ''); setWorkoutDuration(w.duration); setWorkoutParts(w.parts); setWorkoutActivities(w.activities ?? []); }
        break;
      }
      case 'sleep': {
        const s = dayEvents.find(e => e.type === 'sleep') as SleepHealthEvent | undefined;
        if (s) { setEditingId(s.id); setSleepBedtime(s.bedtime); setSleepWakeTime(s.wakeTime); setSleepQuality(s.quality); setSleepNote(s.note ?? ''); }
        break;
      }
      case 'diet': {
        const d = dayEvents.find(e => e.type === 'diet') as DietHealthEvent | undefined;
        if (d) { setEditingId(d.id); setDietText(d.rawInput ?? ''); setDietCalories(d.calories); setDietProtein(d.protein ?? ''); setDietCarbs(d.carbs ?? ''); setDietFat(d.fat ?? ''); setDietFiber(d.fiber ?? ''); setDietNote(d.note ?? ''); setDietParsed(true); }
        else setDietText(loadDietDraft(dateStr)); // 恢复当天草稿
        break;
      }
      case 'period': {
        const p = dayEvents.find(e => e.type === 'period') as PeriodHealthEvent | undefined;
        if (p) { setEditingId(p.id); setPeriodFlow(p.flow); }
        const sym = dayEvents.find(e => e.type === 'symptom') as SymptomHealthEvent | undefined;
        setPmsSymptoms((sym?.symptoms ?? []).filter(s => PMS_SYMPTOMS.includes(s)));
        break;
      }
      case 'symptom': {
        const s = dayEvents.find(e => e.type === 'symptom') as SymptomHealthEvent | undefined;
        if (s) { setEditingId(s.id); setPeriodSymptoms(s.symptoms.filter(x => GENERAL_SYMPTOMS.includes(x))); }
        break;
      }
    }

    setRecordMode(mode);
  };

  // ── Clay Design Tokens (from shared design system) ──────────────────────────
  const clay = {
    bg: F.appBg,
    card:       { background: F.surface, borderRadius: R.bigCard, boxShadow: S.raisedSoft, border: `1px solid ${F.borderSoft}` },
    cardGreen:  { background: HUE.green.tint,  borderRadius: R.bigCard, boxShadow: S.raisedSoft, border: `1px solid ${F.borderSoft}`, borderLeft: `4px solid ${HUE.green.main}` },
    cardRose:   { background: HUE.rose.tint,   borderRadius: R.bigCard, boxShadow: S.raisedSoft, border: `1px solid ${F.borderSoft}`, borderLeft: `4px solid ${HUE.rose.main}` },
    cardViolet: { background: HUE.purple.tint,  borderRadius: R.bigCard, boxShadow: S.raisedSoft, border: `1px solid ${F.borderSoft}`, borderLeft: `4px solid ${HUE.purple.main}` },
    cardIndigo: { background: HUE.blue.tint,   borderRadius: R.bigCard, boxShadow: S.raisedSoft, border: `1px solid ${F.borderSoft}`, borderLeft: `4px solid ${HUE.blue.main}` },
    cardAmber:  { background: HUE.amber.tint,  borderRadius: R.bigCard, boxShadow: S.raisedSoft, border: `1px solid ${F.borderSoft}`, borderLeft: `4px solid ${HUE.amber.main}` },
    btnPrimary: { background: F.textPrimary, color: F.surfaceRaised, borderRadius: 999, boxShadow: S.raisedSoft, height: 32 },
    press:      'active:translate-y-[3px] transition-transform duration-150',
    pressSmall: 'active:translate-y-[2px] transition-transform duration-150',
  } as const;

  // ── SVG ring helper ──
  const ringArc = (r: number, pct: number) => {
    const c = 2 * Math.PI * r;
    const arc = c * Math.min(pct, 1);
    return { strokeDasharray: `${arc.toFixed(1)} ${(c - arc).toFixed(1)}` };
  };

  // 溢出弧：沿弧线方向的渐变（SVG linearGradient 做不了环形渐变，用分段插值模拟）。
  // 从 12 点接着底色出发，越往前越亮，亮色尖端 = 溢出终点。
  const overflowArc = (r: number, overflowPct: number, from: string, to: string) => {
    const pct = Math.min(overflowPct, 0.999); // 超过两倍目标也只画一圈
    const segs = Math.max(8, Math.ceil(pct * 48));
    const segLen = pct / segs;
    return Array.from({ length: segs }, (_, i) => (
      <circle key={i} cx="124" cy="124" r={r} fill="none"
        stroke={lerpColor(from, to, (i + 1) / segs)} strokeWidth="16"
        strokeLinecap={i === segs - 1 ? 'round' : 'butt'}
        {...ringArc(r, i === segs - 1 ? segLen : segLen * 1.15)} // 中段微重叠防缝隙
        transform={`rotate(${-90 + i * segLen * 360} 124 124)`} />
    ));
  };

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full overflow-hidden relative" style={{ background: clay.bg }}>

      {/* ── Header ── */}
      <div className="shrink-0 px-5 flex flex-col sticky top-0 z-20" style={{ paddingTop: 'var(--chrome-top)', background: clay.bg }}>
      <div className="py-3 flex items-center justify-between">
        <button onClick={closeApp}
          className={`w-11 h-11 flex items-center justify-center ${clay.pressSmall}`}
          style={{ background: F.surfaceRaised, borderRadius: R.pill, border: `1px solid ${F.borderSoft}`, boxShadow: S.raisedSoft }}>
          <CaretLeft size={20} weight="bold" style={{ color: F.textSecondary }} />
        </button>

        {topTab === 'calendar' && (
          <div className="relative">
            <div className="flex items-center gap-2 px-4 py-1.5"
              style={{ background: F.surfaceRaised, borderRadius: R.pill, boxShadow: S.raisedSoft, width: 192 }}>
              <button onClick={prevMonth} className={clay.pressSmall}>
                <CaretLeft size={14} weight="bold" style={{ color: F.textTertiary }} />
              </button>
              <button onClick={() => setShowDatePicker(v => !v)}
                className="text-sm font-bold flex-1 text-center active:opacity-60 transition-opacity"
                style={{ color: F.textPrimary }}>
                {viewYear} · {MONTH_NAMES[viewMonth - 1]}
              </button>
              <button onClick={nextMonth} className={clay.pressSmall}>
                <CaretRight size={14} weight="bold" style={{ color: F.textTertiary }} />
              </button>
            </div>
            {showDatePicker && (<>
              <div className="fixed inset-0 z-40" onClick={() => setShowDatePicker(false)} />
              <div className="absolute top-12 left-1/2 -translate-x-1/2 z-50 p-3 w-56"
                style={{ background: F.surfaceRaised, borderRadius: R.bigCard, boxShadow: S.floating, border: `1px solid ${F.borderSoft}` }}>
                <div className="flex items-center justify-between mb-2">
                  <button onClick={() => setViewYear(y => y - 1)} className="px-2 py-1 active:opacity-60"><CaretLeft size={12} weight="bold" style={{ color: F.textTertiary }} /></button>
                  <span className="text-xs font-bold" style={{ color: F.textPrimary }}>{viewYear}</span>
                  <button onClick={() => setViewYear(y => y + 1)} className="px-2 py-1 active:opacity-60"><CaretRight size={12} weight="bold" style={{ color: F.textTertiary }} /></button>
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                  {MONTH_NAMES.map((mn, i) => (
                    <button key={i} onClick={() => { setViewMonth(i + 1); setShowDatePicker(false); }}
                      className="py-1.5 text-xs font-medium rounded-lg active:scale-95 transition-all"
                      style={{
                        background: viewMonth === i + 1 ? F.accent : 'transparent',
                        color: viewMonth === i + 1 ? F.surfaceRaised : F.textSecondary,
                        boxShadow: viewMonth === i + 1 ? S.raisedSoft : 'none',
                      }}>{mn.replace('月', '')}</button>
                  ))}
                </div>
                <button onClick={() => { setViewYear(today.getFullYear()); setViewMonth(today.getMonth() + 1); setShowDatePicker(false); }}
                  className="w-full mt-2 py-1.5 text-[10px] font-medium rounded-lg active:scale-95"
                  style={{ background: F.surfaceSunken, color: F.textSecondary }}>回到今天</button>
              </div>
            </>)}
          </div>
        )}

        {topTab === 'today' && (
          <div className="relative">
            <div className="flex items-center gap-2 px-4 py-1.5"
              style={{ background: F.surfaceRaised, borderRadius: R.pill, boxShadow: S.raisedSoft, width: 192 }}>
              <button onClick={() => setTodayViewOffset(o => o - 1)} className={clay.pressSmall}>
                <CaretLeft size={14} weight="bold" style={{ color: F.textTertiary }} />
              </button>
              <button onClick={() => setShowDatePicker(v => !v)}
                className="text-sm font-bold flex-1 text-center whitespace-nowrap active:opacity-60 transition-opacity"
                style={{ color: F.textPrimary }}>
                {viewDay.getMonth() + 1}月{viewDay.getDate()}日 · 周{WEEKDAYS[viewDay.getDay()]}
              </button>
              <button onClick={() => setTodayViewOffset(o => o + 1)} className={clay.pressSmall}>
                <CaretRight size={14} weight="bold" style={{ color: F.textTertiary }} />
              </button>
            </div>
            {showDatePicker && (<>
              <div className="fixed inset-0 z-40" onClick={() => setShowDatePicker(false)} />
              <div className="absolute top-12 left-1/2 -translate-x-1/2 z-50 p-3 w-64"
                style={{ background: F.surfaceRaised, borderRadius: R.bigCard, boxShadow: S.floating, border: `1px solid ${F.borderSoft}` }}>
                <div className="flex items-center justify-between mb-2">
                  <button onClick={() => setTodayViewOffset(() => { const prev = new Date(viewDay); prev.setMonth(prev.getMonth() - 1); return Math.round((prev.getTime() - today.getTime()) / 86400000); })}
                    className="px-2 py-1 active:opacity-60"><CaretLeft size={12} weight="bold" style={{ color: F.textTertiary }} /></button>
                  <span className="text-xs font-bold" style={{ color: F.textPrimary }}>{pickerYear} · {MONTH_NAMES[pickerMonth - 1]}</span>
                  <button onClick={() => setTodayViewOffset(() => { const nxt = new Date(viewDay); nxt.setMonth(nxt.getMonth() + 1); return Math.round((nxt.getTime() - today.getTime()) / 86400000); })}
                    className="px-2 py-1 active:opacity-60"><CaretRight size={12} weight="bold" style={{ color: F.textTertiary }} /></button>
                </div>
                <div className="grid grid-cols-7 gap-0.5 text-center">
                  {WEEKDAYS.map(d => <div key={d} className="text-[9px] font-medium py-0.5" style={{ color: F.textTertiary }}>{d}</div>)}
                  {pickerCells.map((day, i) => day === 0 ? <div key={`e${i}`} /> : (
                    <button key={i} onClick={() => {
                      const target = new Date(pickerYear, pickerMonth - 1, day);
                      setTodayViewOffset(Math.round((target.getTime() - today.getTime()) / 86400000));
                      setShowDatePicker(false);
                    }}
                      className="py-1 text-xs rounded-lg active:scale-95 transition-all"
                      style={{
                        fontWeight: toDateStr(pickerYear, pickerMonth, day) === todayStr ? 700 : 400,
                        background: day === viewDay.getDate() && pickerMonth === viewDay.getMonth() + 1 ? F.accent : 'transparent',
                        color: day === viewDay.getDate() && pickerMonth === viewDay.getMonth() + 1 ? F.surfaceRaised : toDateStr(pickerYear, pickerMonth, day) === todayStr ? F.accent : F.textPrimary,
                      }}>{day}</button>
                  ))}
                </div>
                <button onClick={() => { setTodayViewOffset(0); setShowDatePicker(false); }}
                  className="w-full mt-2 py-1.5 text-[10px] font-medium rounded-lg active:scale-95"
                  style={{ background: F.surfaceSunken, color: F.textSecondary }}>回到今天</button>
              </div>
            </>)}
          </div>
        )}

        <button onClick={openProfileSetup}
          className={`w-11 h-11 flex items-center justify-center ${clay.pressSmall}`}
          style={{ background: F.surfaceRaised, borderRadius: R.pill, border: `1px solid ${F.borderSoft}`, boxShadow: S.raisedSoft }}>
          <Gear size={16} weight="bold" style={{ color: F.textTertiary }} />
        </button>
      </div>
      </div>

      {/* ── Top tab bar (月历 / 今日) ── */}
      <div className="shrink-0 mx-5 mb-2 flex p-1"
        style={{ background: F.surfaceSunken, borderRadius: R.panel, boxShadow: S.sunken }}>
        {([
          { id: 'calendar' as TopTab, label: '月历' },
          { id: 'today'    as TopTab, label: '今日' },
        ]).map(tab => (
          <button key={tab.id} onClick={() => { setTopTab(tab.id); setShowDatePicker(false); }}
            className={`flex-1 py-2 text-[13px] ${clay.pressSmall}`}
            style={{
              borderRadius: R.large,
              background: topTab === tab.id ? F.surfaceRaised : 'transparent',
              color: topTab === tab.id ? F.textPrimary : F.textTertiary,
              fontWeight: topTab === tab.id ? 600 : 400,
              boxShadow: topTab === tab.id ? S.raisedSoft : 'none',
            }}>
            {tab.label}
          </button>
        ))}
      </div>

      {/* ════════════════════════════════════════════════════
          TAB: 月历
      ════════════════════════════════════════════════════ */}
      {topTab === 'calendar' && (
        <>
          {/* Cycle Status */}
          <div className="shrink-0 mx-5 mt-1 px-4 py-3.5 flex items-center justify-between"
            style={{
              background: cycleStatus.lastPeriodStart ? CAT_COLORS.period.bg : F.surfaceSunken,
              borderRadius: R.bigCard,
              boxShadow: cycleStatus.lastPeriodStart ? S.raisedSoft : S.sunken,
            }}>
            <div className="flex items-center gap-1.5">
              <Drop size={13} weight="fill" style={{ color: cycleStatus.lastPeriodStart ? CAT_COLORS.period.shadow : F.textTertiary }} />
              {cycleStatus.lastPeriodStart ? (
                <span className="text-[13px]" style={{ color: CAT_COLORS.period.fg }}>
                  周期第 <span className="font-bold" style={{ color: CAT_COLORS.period.shadow }}>{cycleStatus.cycleDay}</span> 天
                  {cycleStatus.uncertain && <span className="text-xs ml-1" style={{ color: F.textTertiary }}>（预测不确定）</span>}
                </span>
              ) : (
              <span className="text-sm" style={{ color: F.textTertiary }}>暂无经期数据</span>
              )}
            </div>
            {cycleStatus.lastPeriodStart && (
            <span className="text-xs" style={{ color: F.textTertiary }}>预计下次 {cycleStatus.nextRangeStr}</span>
            )}
          </div>

          {/* Legend — pills for range fills, dots for event markers */}
          <div className="shrink-0 mx-5 mt-2 flex items-center gap-3 flex-wrap">
            {/* Range legends (pill = calendar background fill) */}
            <span className="text-[12px]" style={{
              background: CAT_COLORS.period.bg, color: CAT_COLORS.period.fg, fontWeight: 500,
              borderRadius: R.pill, padding: '4px 10px', boxShadow: S.raisedSoft,
            }}>经期</span>
            <span className="text-[12px]" style={{
              background: CAT_COLORS.sleep.bg, color: CAT_COLORS.sleep.fg, fontWeight: 500,
              borderRadius: R.pill, padding: '4px 10px', boxShadow: S.raisedSoft,
              border: `1.5px dashed ${CAT_COLORS.sleep.shadow}`,
            }}>排卵窗</span>
            {/* Dot legends (dot = calendar event dot) */}
            <span className="flex items-center gap-1.5 text-[12px]" style={{ color: CAT_COLORS.workout.fg, fontWeight: 500 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: CAT_COLORS.workout.shadow, flexShrink: 0 }} />训练
            </span>
            <span className="flex items-center gap-1.5 text-[12px]" style={{ color: CAT_COLORS.symptom.fg, fontWeight: 500 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: CAT_COLORS.symptom.shadow, flexShrink: 0 }} />症状
            </span>
            {isLoading && <div className="ml-auto"><ArrowClockwise size={12} className="animate-spin" style={{ color: F.textTertiary }} /></div>}
          </div>

          {/* Calendar */}
          <div className="shrink-0 px-5 mt-3">
            <div className="grid grid-cols-7 mb-1">
            {WEEKDAYS.map(d => <div key={d} className="text-center text-xs font-semibold py-1" style={{ color: F.textTertiary }}>{d}</div>)}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {calendarDays.map((day, idx) => {
                if (day === null) return <div key={`e${idx}`} className="h-11" />;
                const dateStr  = toDateStr(viewYear, viewMonth, day);
                const events   = eventMap[dateStr] || [];
                const isToday  = dateStr === todayStr;
                const isSel    = dateStr === selectedDate;
                const isOvul   = ovulationSet.has(dateStr);
                const periodEv = events.find(e => e.type === 'period') as PeriodHealthEvent | undefined;
                const hasWorkout = events.some(e => e.type === 'workout');
                const hasSymptom = events.some(e => e.type === 'symptom');
                return (
                  <button key={dateStr} onClick={() => setSelectedDate(isSel ? null : dateStr)}
                    className={`flex flex-col items-center justify-center h-11 ${clay.pressSmall}`}
                    style={{
                      borderRadius: R.medium,
                      background: isSel ? F.borderStrong
                        : periodEv ? HUE.rose.tint
                        : isOvul ? HUE.blue.tint
                        : 'transparent',
                      boxShadow: isSel
                        ? S.sunken
                        : 'none',
                      border: isToday && !isSel ? `2px solid ${HUE.amber.ink}` : 'none',
                    }}>
                    <span style={{
                      fontSize: '16px', lineHeight: 1, marginBottom: 2,
                      fontWeight: (isSel || isToday) ? 700 : 400,
                      color: (isSel || isToday) ? F.textPrimary : F.textPrimary,
                    }}>{day}</span>
                    <div className="flex gap-0.5 items-center h-2">
                      {/* 经期不画点：整格已是粉色背景 */}
                      {hasWorkout && <div style={{ width: 6, height: 6, borderRadius: '50%', background: CAT_COLORS.workout.shadow }} />}
                      {hasSymptom && <div style={{ width: 6, height: 6, borderRadius: '50%', background: CAT_COLORS.symptom.shadow }} />}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="shrink-0 mx-5 mt-3 h-px" style={{ background: F.divider }} />

          {/* Detail Section */}
          <div className="flex-1 overflow-y-auto px-5 pt-4" style={{ paddingBottom: 'calc(1rem + var(--safe-bottom))' }}>{/* [EM: safe-bottom] */}
            {!selectedDate ? (
              <div className="flex items-center justify-center gap-2 mt-8"
                style={{ background: F.surfaceSunken, borderRadius: R.bigCard, boxShadow: S.sunken, padding: '20px 24px' }}>
                <CalendarBlank size={18} weight="regular" style={{ color: F.textTertiary, flexShrink: 0 }} />
                <span style={{ fontSize: '13px', color: F.textTertiary }}>点击日期查看详情</span>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-bold tracking-wider" style={{ color: F.textTertiary }}>
                    {viewMonth}月{parseInt(selectedDate.split('-')[2])}日
                  </span>
                  <button onClick={() => openRecord('workout')}
                    className={`flex items-center gap-1.5 text-[12px] font-bold px-4 ${clay.pressSmall}`}
                    style={clay.btnPrimary}>
                    <Plus size={13} weight="bold" /> 记录
                  </button>
                </div>

                {selectedEvents.length === 0 ? (
                  <div className="flex items-center justify-center gap-2 mt-4"
                    style={{ background: F.surfaceSunken, borderRadius: R.bigCard, boxShadow: S.sunken, padding: '20px 24px' }}>
                    <Plus size={18} weight="regular" style={{ color: F.textTertiary, flexShrink: 0 }} />
                    <span style={{ fontSize: '13px', color: F.textTertiary }}>暂无记录</span>
                  </div>
                ) : (
                  <>

                {selWorkout && (
                  <div className="mb-3" style={{ ...clay.cardGreen, padding: '14px 16px' }}>
                    <div className="flex items-center gap-3">
                      <div style={{ width: 36, height: 36, borderRadius: R.small, background: CAT_COLORS.workout.shadow, display: 'flex', alignItems: 'center', justifyContent: 'center', color: F.surfaceRaised, fontSize: '13px', fontWeight: 700, flexShrink: 0 }}><Barbell size={18} weight="fill" /></div>
                      <div className="flex-1 min-w-0">
                        <span style={{ fontSize: '15px', fontWeight: 600, color: CAT_COLORS.workout.fg }}>训练</span>
                        <span className="ml-2" style={{ fontSize: '13px', fontWeight: 400, color: `${CAT_COLORS.workout.fg}99` }}>{selWorkout.duration}min{selWorkout.calories ? ` · ${selWorkout.calories}kcal` : ''}</span>
                      </div>
                      <div className="ml-auto flex gap-1 shrink-0">
                        <button onClick={() => startEditWorkout(selWorkout)} className={`p-2 ${clay.pressSmall}`}
                          style={{ borderRadius: R.pill, background: CAT_COLORS.workout.bg, boxShadow: S.raisedSoft }}>
                          <PencilSimple size={14} style={{ color: CAT_COLORS.workout.shadow }} />
                        </button>
                        <button onClick={() => handleDelete(selWorkout.id, '训练记录')} className={`p-2 ${clay.pressSmall}`}
                          style={{ borderRadius: R.pill, background: CAT_COLORS.period.bg, boxShadow: S.raisedSoft }}>
                          <Trash size={14} style={{ color: CAT_COLORS.period.shadow }} />
                        </button>
                      </div>
                    </div>
                    {selWorkout.summary && selWorkout.summary !== '训练' && (
                      <p className="mt-1 ml-12" style={{ fontSize: '13px', color: `${CAT_COLORS.workout.fg}99`, lineHeight: 1.5 }}>{selWorkout.summary}</p>
                    )}
                  </div>
                )}

                {selSleep && (
                  <div className="mb-3" style={{ ...clay.cardIndigo, padding: '14px 16px' }}>
                    <div className="flex items-center gap-3">
                      <div style={{ width: 36, height: 36, borderRadius: R.small, background: CAT_COLORS.sleep.shadow, display: 'flex', alignItems: 'center', justifyContent: 'center', color: F.surfaceRaised, fontSize: '13px', fontWeight: 700, flexShrink: 0 }}><MoonStars size={18} weight="fill" /></div>
                      <div className="flex-1 min-w-0">
                        <span style={{ fontSize: '15px', fontWeight: 600, color: CAT_COLORS.sleep.fg }}>睡眠</span>
                        <span className="ml-2" style={{ fontSize: '13px', fontWeight: 400, color: `${CAT_COLORS.sleep.fg}99` }}>
                          {selSleep.bedtime} → {selSleep.wakeTime} · {fmtDuration(selSleep.duration)} · {QUALITY_LABEL[selSleep.quality]}
                        </span>
                      </div>
                      <div className="ml-auto flex gap-1 shrink-0">
                        <button onClick={() => startEditSleep(selSleep)} className={`p-2 ${clay.pressSmall}`}
                          style={{ borderRadius: R.pill, background: CAT_COLORS.sleep.bg, boxShadow: S.raisedSoft }}>
                          <PencilSimple size={14} style={{ color: CAT_COLORS.sleep.shadow }} />
                        </button>
                        <button onClick={() => handleDelete(selSleep.id, '睡眠记录')} className={`p-2 ${clay.pressSmall}`}
                          style={{ borderRadius: R.pill, background: CAT_COLORS.period.bg, boxShadow: S.raisedSoft }}>
                          <Trash size={14} style={{ color: CAT_COLORS.period.shadow }} />
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {selDiet.length > 0 && selDiet.map(d => (
                  <div key={d.id} className="mb-3" style={{ ...clay.cardAmber, padding: '14px 16px' }}>
                    <div className="flex items-center gap-3">
                      <div style={{ width: 36, height: 36, borderRadius: R.small, background: CAT_COLORS.diet.shadow, display: 'flex', alignItems: 'center', justifyContent: 'center', color: F.surfaceRaised, fontSize: '13px', fontWeight: 700, flexShrink: 0 }}><ForkKnife size={18} weight="fill" /></div>
                      <div className="flex-1 min-w-0">
                        <span style={{ fontSize: '15px', fontWeight: 600, color: CAT_COLORS.diet.fg }}>{d.note || '饮食'}</span>
                        <span className="ml-2" style={{ fontSize: '13px', fontWeight: 400, color: `${CAT_COLORS.diet.fg}99` }}>{d.calories}kcal{d.protein ? ` · 蛋白${d.protein}g` : ''}</span>
                      </div>
                      <div className="ml-auto flex gap-1 shrink-0">
                        <button onClick={() => startEditDiet(d)} className={`p-2 ${clay.pressSmall}`}
                          style={{ borderRadius: R.pill, background: CAT_COLORS.diet.bg, boxShadow: S.raisedSoft }}>
                          <PencilSimple size={14} style={{ color: CAT_COLORS.diet.shadow }} />
                        </button>
                        <button onClick={() => handleDelete(d.id, '饮食记录')} className={`p-2 ${clay.pressSmall}`}
                          style={{ borderRadius: R.pill, background: CAT_COLORS.period.bg, boxShadow: S.raisedSoft }}>
                          <Trash size={14} style={{ color: CAT_COLORS.period.shadow }} />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}

                {selPeriod && (
                  <div className="mb-3" style={{ ...clay.cardRose, padding: '14px 16px' }}>
                    <div className="flex items-center gap-3">
                      <div style={{ width: 36, height: 36, borderRadius: R.small, background: CAT_COLORS.period.shadow, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <Drop size={16} weight="fill" color={F.surfaceRaised} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <span style={{ fontSize: '15px', fontWeight: 600, color: CAT_COLORS.period.fg }}>经期</span>
                        <span className="ml-2" style={{ fontSize: '13px', fontWeight: 400, color: `${CAT_COLORS.period.fg}99` }}>{FLOW_LABEL[selPeriod.flow]}</span>
                      </div>
                      <div className="ml-auto flex gap-1 shrink-0">
                        <button onClick={() => startEditPeriod(selPeriod)} className={`p-2 ${clay.pressSmall}`}
                          style={{ borderRadius: R.pill, background: CAT_COLORS.period.bg, boxShadow: S.raisedSoft }}>
                          <PencilSimple size={14} style={{ color: CAT_COLORS.period.shadow }} />
                        </button>
                        <button onClick={() => handleDelete(selPeriod.id, '经期记录')} className={`p-2 ${clay.pressSmall}`}
                          style={{ borderRadius: R.pill, background: CAT_COLORS.period.bg, boxShadow: S.raisedSoft }}>
                          <Trash size={14} style={{ color: CAT_COLORS.period.shadow }} />
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {selSymptom && (
                  <div style={{ ...clay.cardViolet, padding: '14px 16px' }}>
                    <div className="flex items-center gap-3">
                      <div style={{ width: 36, height: 36, borderRadius: R.small, background: CAT_COLORS.symptom.shadow, display: 'flex', alignItems: 'center', justifyContent: 'center', color: F.surfaceRaised, fontSize: '13px', fontWeight: 700, flexShrink: 0 }}><Bandaids size={18} weight="fill" /></div>
                      <div className="flex-1 min-w-0">
                        <span style={{ fontSize: '15px', fontWeight: 600, color: CAT_COLORS.symptom.fg }}>症状</span>
                        <span className="ml-2" style={{ fontSize: '13px', fontWeight: 400, color: `${CAT_COLORS.symptom.fg}99` }}>{selSymptom.symptoms.join('、')}</span>
                      </div>
                      <div className="ml-auto flex gap-1 shrink-0">
                        <button onClick={() => startEditSymptom(selSymptom)} className={`p-2 ${clay.pressSmall}`}
                          style={{ borderRadius: R.pill, background: CAT_COLORS.symptom.bg, boxShadow: S.raisedSoft }}>
                          <PencilSimple size={14} style={{ color: CAT_COLORS.symptom.shadow }} />
                        </button>
                        <button onClick={() => handleDelete(selSymptom.id, '症状记录')} className={`p-2 ${clay.pressSmall}`}
                          style={{ borderRadius: R.pill, background: CAT_COLORS.period.bg, boxShadow: S.raisedSoft }}>
                          <Trash size={14} style={{ color: CAT_COLORS.period.shadow }} />
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                  </>
                )}
              </>
            )}
          </div>
        </>
      )}

      {/* ════════════════════════════════════════════════════
          TAB: 今日
      ════════════════════════════════════════════════════ */}
      {topTab === 'today' && (
        <div className="flex-1 overflow-y-auto px-5" style={{ paddingBottom: 'calc(1rem + var(--safe-bottom))' }}>{/* [EM: safe-bottom] */}

          {/* Big nested clay donut ring */}
          <div className="relative mx-auto" style={{ width: 248, height: 248 }}>
            {/* Outer raised rim */}
            <div className="absolute inset-0 rounded-full" style={{
              background: F.surface,
              boxShadow: S.raisedMedium,
            }} />
            {/* Track groove — recessed channel where arcs sit */}
            <div className="absolute rounded-full" style={{
              top: 10, left: 10, right: 10, bottom: 10,
              background: F.surfaceSunken,
              boxShadow: S.sunken,
            }} />
            {/* Inner raised circle (donut hole) */}
            <div className="absolute rounded-full" style={{
              top: 46, left: 46, width: 156, height: 156,
              background: F.surfaceRaised,
              boxShadow: S.raisedMedium,
            }} />
            {/* SVG data arcs */}
            <svg viewBox="0 0 248 248" width="248" height="248" className="absolute inset-0">
              <defs>
                <filter id="arcShadow" x="-20%" y="-20%" width="140%" height="140%">
                  <feDropShadow dx="1" dy="2" stdDeviation="3" floodColor="rgba(70,66,58,0.18)" />
                </filter>
              </defs>
              {/* Sleep ring (outer, r=107): track → arc → overflow */}
              <circle cx="124" cy="124" r="107" fill="none" stroke={F.surfaceSunken} strokeWidth="20" />
              <circle cx="124" cy="124" r="107" fill="none"
                stroke={CAT_COLORS.sleep.active} strokeWidth="16" strokeLinecap="round"
                filter="url(#arcShadow)"
                {...ringArc(107, todaySleep ? todaySleep.duration / sleepTarget : 0)}
                transform="rotate(-90 124 124)" />
              {todaySleep && todaySleep.duration / sleepTarget > 1 &&
                overflowArc(107, todaySleep.duration / sleepTarget - 1, CAT_COLORS.sleep.active, CAT_COLORS.sleep.shadow)
              }
              {/* Workout ring (mid, r=88) */}
              <circle cx="124" cy="124" r="88" fill="none" stroke={F.surfaceSunken} strokeWidth="20" />
              <circle cx="124" cy="124" r="88" fill="none"
                stroke={CAT_COLORS.workout.active} strokeWidth="16" strokeLinecap="round"
                filter="url(#arcShadow)"
                {...ringArc(88, todayWorkout?.calories ? todayWorkout.calories / workoutTarget : 0)}
                transform="rotate(-90 124 124)" />
              {todayWorkout?.calories && todayWorkout.calories / workoutTarget > 1 &&
                overflowArc(88, todayWorkout.calories / workoutTarget - 1, CAT_COLORS.workout.active, CAT_COLORS.workout.shadow)
              }
              {/* Diet ring (inner, r=69) — split by macronutrient when available */}
              <circle cx="124" cy="124" r="69" fill="none" stroke={F.surfaceSunken} strokeWidth="20" />
              {dietHasMacros ? (
                <>
                  {dietProteinKcal > 0 && (
                    <circle cx="124" cy="124" r="69" fill="none"
                      stroke={MACRO_COLORS.protein} strokeWidth="16" strokeLinecap="round"
                      filter="url(#arcShadow)"
                      {...ringArc(69, dietProteinKcal / calTarget)}
                      transform="rotate(-90 124 124)" />
                  )}
                  {dietCarbsKcal > 0 && (
                    <circle cx="124" cy="124" r="69" fill="none"
                      stroke={MACRO_COLORS.carbs} strokeWidth="16" strokeLinecap="round"
                      filter="url(#arcShadow)"
                      {...ringArc(69, dietCarbsKcal / calTarget)}
                      transform={`rotate(${-90 + (dietProteinKcal / calTarget) * 360} 124 124)`} />
                  )}
                  {dietFatKcal > 0 && (
                    <circle cx="124" cy="124" r="69" fill="none"
                      stroke={MACRO_COLORS.fat} strokeWidth="16" strokeLinecap="round"
                      filter="url(#arcShadow)"
                      {...ringArc(69, dietFatKcal / calTarget)}
                      transform={`rotate(${-90 + ((dietProteinKcal + dietCarbsKcal) / calTarget) * 360} 124 124)`} />
                  )}
                </>
              ) : todayDietTotal > 0 ? (
                <>
                  <circle cx="124" cy="124" r="69" fill="none"
                    stroke={CAT_COLORS.diet.active} strokeWidth="16" strokeLinecap="round"
                    filter="url(#arcShadow)"
                    {...ringArc(69, todayDietTotal / calTarget)}
                    transform="rotate(-90 124 124)" />
                  {todayDietTotal / calTarget > 1 &&
                    overflowArc(69, todayDietTotal / calTarget - 1, CAT_COLORS.diet.active, CAT_COLORS.diet.shadow)
                  }
                </>
              ) : null}
            </svg>
            {/* Center text — caloric deficit */}
            <div className="absolute inset-0 flex flex-col items-center justify-center z-10">
              {deficit != null ? (
                <>
                  <span style={{ fontSize: '11px', color: F.textSecondary }}>热量缺口</span>
                  <span style={{ fontSize: '28px', fontWeight: 700, color: deficit >= 0 ? CAT_COLORS.workout.shadow : CAT_COLORS.diet.shadow }}>
                    {deficit >= 0 ? `+${deficit}` : deficit}
                  </span>
                  <span style={{ fontSize: '11px', color: F.textSecondary }}>kcal</span>
                </>
              ) : (
                <>
                  <span style={{ fontSize: '11px', color: F.textSecondary }}>摄入</span>
                  <span style={{ fontSize: '28px', fontWeight: 700, color: F.textPrimary }}>{todayDietTotal || '—'}</span>
                  <span style={{ fontSize: '11px', color: F.textSecondary }}>{todayDietTotal ? 'kcal' : ''}</span>
                </>
              )}
            </div>
          </div>

          {/* Ring legend pills */}
          <div className="flex justify-center gap-2 mt-3 mb-4">
            <span className="flex items-center gap-1.5" style={{ fontSize: '12px', fontWeight: 500, color: CAT_COLORS.sleep.fg, background: CAT_COLORS.sleep.bg, borderRadius: R.pill, padding: '5px 12px', boxShadow: S.raisedSoft }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: CAT_COLORS.sleep.active, flexShrink: 0 }} />
              睡 <b>{todaySleep ? fmtDuration(todaySleep.duration) : '—'}</b>
            </span>
            <span className="flex items-center gap-1.5" style={{ fontSize: '12px', fontWeight: 500, color: CAT_COLORS.workout.fg, background: CAT_COLORS.workout.bg, borderRadius: R.pill, padding: '5px 12px', boxShadow: S.raisedSoft }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: CAT_COLORS.workout.active, flexShrink: 0 }} />
              练 <b>{todayWorkout ? `${todayWorkout.calories ?? 0}k` : '—'}</b>
            </span>
            <span className="flex items-center gap-1.5" style={{ fontSize: '12px', fontWeight: 500, color: CAT_COLORS.diet.fg, background: CAT_COLORS.diet.bg, borderRadius: R.pill, padding: '5px 12px', boxShadow: S.raisedSoft }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: CAT_COLORS.diet.active, flexShrink: 0 }} />
              食 <b>{todayDietTotal ? `${todayDietTotal}k` : '—'}</b>
            </span>
          </div>
          {dietHasMacros && (
          <div className="flex justify-center gap-4 -mt-2 mb-3 text-[10px]" style={{ color: F.textTertiary }}>
              <span className="flex items-center gap-1">
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: MACRO_COLORS.protein }} />蛋白
              </span>
              <span className="flex items-center gap-1">
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: MACRO_COLORS.carbs }} />碳水
              </span>
              <span className="flex items-center gap-1">
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: MACRO_COLORS.fat }} />脂肪
              </span>
            </div>
          )}

          {/* Weight row */}
          <div className="mb-3">
            <button
              onClick={() => setShowWeightTrend(v => !v)}
              className={`flex items-center gap-2 px-3 py-2 w-full ${clay.pressSmall}`}
              style={{ background: F.surfaceRaised, borderRadius: R.bigCard, boxShadow: S.raisedSoft, border: 'none', cursor: 'pointer' }}>
              <span style={{ fontSize: '12px', fontWeight: 700, color: F.textSecondary }}>体重</span>
              <input type="number" step="0.1"
                defaultValue={todayWeight?.value ?? profile?.weightKg ?? ''}
                placeholder="kg"
                onClick={e => e.stopPropagation()}
                className="w-14 text-sm font-bold text-right focus:outline-none bg-transparent"
                style={{ color: F.textPrimary }}
                onBlur={e => {
                  const v = parseFloat(e.target.value);
                  if (v > 0 && v !== todayWeight?.value) handleSaveWeight(v);
                }} />
              <span style={{ fontSize: '10px', color: F.textTertiary }}>kg</span>
              <div className="flex-1" />
              <ChartLineUp size={14} weight="bold" style={{ color: showWeightTrend ? HUE.blue.main : F.textTertiary }} />
              <CaretRight size={14} weight="bold" style={{ color: F.textTertiary }} />
            </button>
          </div>

          {/* BMR info line */}
          {bmr > 0 && (
            <div className="flex items-center gap-2 mb-3">
              <span style={{ background: F.surfaceWarm, borderRadius: R.pill, padding: '4px 10px', fontSize: '11px', color: F.textTertiary, boxShadow: S.raisedSoft }}>
                目标 <b style={{ color: F.textSecondary }}>{calTarget}</b>
              </span>
              <span style={{ background: HUE.green.tint, borderRadius: R.pill, padding: '4px 10px', fontSize: '11px', color: CAT_COLORS.workout.fg, boxShadow: S.raisedSoft }}>
                运动 <b style={{ color: HUE.green.ink }}>+{exerciseCal}</b>
              </span>
              <span style={{ background: HUE.amber.tint, borderRadius: R.pill, padding: '4px 10px', fontSize: '11px', color: CAT_COLORS.diet.fg, boxShadow: S.raisedSoft }}>
                摄入 <b style={{ color: HUE.amber.ink }}>-{todayDietTotal}</b>
              </span>
            </div>
          )}

          {/* Weight trend chart */}
          {showWeightTrend && weightHistory.length > 1 && (() => {
            const vals = weightHistory.map(w => w.value);
            const min = Math.min(...vals) - 0.5;
            const max = Math.max(...vals) + 0.5;
            const range = max - min || 1;
            const W = 280, H = 80;
            const points = vals.map((v, i) => {
              const x = vals.length === 1 ? W / 2 : (i / (vals.length - 1)) * W;
              const y = H - ((v - min) / range) * H;
              return `${x.toFixed(1)},${y.toFixed(1)}`;
            }).join(' ');
            return (
              <div className="mb-3 p-3" style={{ ...clay.card }}>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold" style={{ color: F.textSecondary }}>体重趋势</span>
                  <span className="text-[10px]" style={{ color: F.textTertiary }}>
                    {weightHistory[0].date.slice(5)} → {weightHistory[weightHistory.length - 1].date.slice(5)}
                  </span>
                </div>
                <svg viewBox={`-4 -4 ${W + 8} ${H + 8}`} width="100%" height={H + 8}>
                  <polyline points={points} fill="none" stroke={HUE.indigo.main} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
                  {vals.map((v, i) => {
                    const x = vals.length === 1 ? W / 2 : (i / (vals.length - 1)) * W;
                    const y = H - ((v - min) / range) * H;
                    return <circle key={i} cx={x} cy={y} r="3" fill={HUE.indigo.main} />;
                  })}
                </svg>
                <div className="flex justify-between text-[10px] mt-1" style={{ color: F.textTertiary }}>
                  <span>{vals[0]}kg</span>
                  <span>最新 <b style={{ color: F.textSecondary }}>{vals[vals.length - 1]}kg</b></span>
                </div>
              </div>
            );
          })()}

          {showWeightTrend && weightHistory.length <= 1 && (
            <div className="mb-3 flex items-center justify-center gap-2"
              style={{ background: F.surfaceSunken, borderRadius: R.bigCard, boxShadow: S.sunken, padding: '20px 24px' }}>
              <ChartLineUp size={18} weight="regular" style={{ color: F.textTertiary, flexShrink: 0 }} />
              <span style={{ fontSize: '12px', color: F.textTertiary }}>记录 2 天以上体重后显示趋势</span>
            </div>
          )}

          {/* Today records */}
          <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-bold tracking-wider" style={{ color: F.textTertiary }}>
              {todayViewOffset === 0 ? '今日记录' : `${viewDay.getMonth() + 1}月${viewDay.getDate()}日记录`}
            </span>
            <button onClick={() => openRecord('workout')}
              className={`flex items-center gap-1.5 text-[12px] font-bold px-4 ${clay.pressSmall}`}
              style={clay.btnPrimary}>
              <Plus size={13} weight="bold" /> 记录
            </button>
          </div>

          {todayWorkout && (
            <div className="mb-3" style={{ ...clay.cardGreen, padding: '14px 16px' }}>
              <div className="flex items-center gap-3">
                <div style={{ width: 36, height: 36, borderRadius: R.small, background: CAT_COLORS.workout.shadow, display: 'flex', alignItems: 'center', justifyContent: 'center', color: F.surfaceRaised, fontSize: '13px', fontWeight: 700, flexShrink: 0 }}><Barbell size={18} weight="fill" /></div>
                <div className="flex-1 min-w-0">
                  <span style={{ fontSize: '14px', fontWeight: 600, color: CAT_COLORS.workout.fg }}>训练</span>
                  <span className="ml-1" style={{ fontSize: '13px', fontWeight: 400, color: `${CAT_COLORS.workout.fg}99` }}>{todayWorkout.duration}min · {todayWorkout.calories ?? '—'}kcal</span>
                </div>
                <div className="flex gap-1 shrink-0">
                  <button onClick={() => startEditWorkout(todayWorkout)} className={`p-1.5 ${clay.pressSmall}`}
                    style={{ borderRadius: R.pill, background: CAT_COLORS.workout.bg, boxShadow: S.raisedSoft }}>
                    <PencilSimple size={12} style={{ color: CAT_COLORS.workout.shadow }} />
                  </button>
                  <button onClick={() => handleDelete(todayWorkout.id, '训练记录')} className={`p-1.5 ${clay.pressSmall}`}
                    style={{ borderRadius: R.pill, background: CAT_COLORS.period.bg, boxShadow: S.raisedSoft }}>
                    <Trash size={12} style={{ color: CAT_COLORS.period.shadow }} />
                  </button>
                </div>
              </div>
            </div>
          )}

          {todaySleep && (
            <div className="mb-3" style={{ ...clay.cardIndigo, padding: '14px 16px' }}>
              <div className="flex items-center gap-3">
                <div style={{ width: 36, height: 36, borderRadius: R.small, background: CAT_COLORS.sleep.shadow, display: 'flex', alignItems: 'center', justifyContent: 'center', color: F.surfaceRaised, fontSize: '13px', fontWeight: 700, flexShrink: 0 }}><MoonStars size={18} weight="fill" /></div>
                <div className="flex-1 min-w-0">
                  <span style={{ fontSize: '14px', fontWeight: 600, color: CAT_COLORS.sleep.fg }}>睡眠</span>
                  <span className="ml-1" style={{ fontSize: '13px', fontWeight: 400, color: `${CAT_COLORS.sleep.fg}99` }}>{todaySleep.bedtime} → {todaySleep.wakeTime} · {fmtDuration(todaySleep.duration)} · {QUALITY_LABEL[todaySleep.quality]}</span>
                </div>
                <div className="flex gap-1 shrink-0">
                  <button onClick={() => startEditSleep(todaySleep)} className={`p-1.5 ${clay.pressSmall}`}
                    style={{ borderRadius: R.pill, background: CAT_COLORS.sleep.bg, boxShadow: S.raisedSoft }}>
                    <PencilSimple size={12} style={{ color: CAT_COLORS.sleep.shadow }} />
                  </button>
                  <button onClick={() => handleDelete(todaySleep.id, '睡眠记录')} className={`p-1.5 ${clay.pressSmall}`}
                    style={{ borderRadius: R.pill, background: CAT_COLORS.period.bg, boxShadow: S.raisedSoft }}>
                    <Trash size={12} style={{ color: CAT_COLORS.period.shadow }} />
                  </button>
                </div>
              </div>
            </div>
          )}

          {todayDiets.map(d => (
            <div key={d.id} className="mb-3" style={{ ...clay.cardAmber, padding: '14px 16px' }}>
              <div className="flex items-center gap-3">
                <div style={{ width: 36, height: 36, borderRadius: R.small, background: CAT_COLORS.diet.shadow, display: 'flex', alignItems: 'center', justifyContent: 'center', color: F.surfaceRaised, fontSize: '13px', fontWeight: 700, flexShrink: 0 }}><ForkKnife size={18} weight="fill" /></div>
                <div className="flex-1 min-w-0">
                  <span style={{ fontSize: '14px', fontWeight: 600, color: CAT_COLORS.diet.fg }}>{d.note || '饮食'}</span>
                  <span className="ml-1" style={{ fontSize: '13px', fontWeight: 400, color: `${CAT_COLORS.diet.fg}99` }}>{d.calories}kcal{d.protein ? ` · 蛋白${d.protein}g` : ''}</span>
                </div>
                <div className="flex gap-1 shrink-0">
                  <button onClick={() => startEditDiet(d)} className={`p-1.5 ${clay.pressSmall}`}
                    style={{ borderRadius: R.pill, background: CAT_COLORS.diet.bg, boxShadow: S.raisedSoft }}>
                    <PencilSimple size={12} style={{ color: CAT_COLORS.diet.shadow }} />
                  </button>
                  <button onClick={() => handleDelete(d.id, '饮食记录')} className={`p-1.5 ${clay.pressSmall}`}
                    style={{ borderRadius: R.pill, background: CAT_COLORS.period.bg, boxShadow: S.raisedSoft }}>
                    <Trash size={12} style={{ color: CAT_COLORS.period.shadow }} />
                  </button>
                </div>
              </div>
            </div>
          ))}

          {todayPeriod && (
            <div className="mb-3" style={{ ...clay.cardRose, padding: '14px 16px' }}>
              <div className="flex items-center gap-3">
                <div style={{ width: 36, height: 36, borderRadius: R.small, background: CAT_COLORS.period.shadow, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <Drop size={16} weight="fill" color={F.surfaceRaised} />
                </div>
                <div className="flex-1 min-w-0">
                  <span style={{ fontSize: '14px', fontWeight: 600, color: CAT_COLORS.period.fg }}>经期</span>
                  <span className="ml-1" style={{ fontSize: '13px', fontWeight: 400, color: `${CAT_COLORS.period.fg}99` }}>{FLOW_LABEL[todayPeriod.flow]}</span>
                </div>
                <div className="flex gap-1 shrink-0">
                  <button onClick={() => startEditPeriod(todayPeriod)} className={`p-1.5 ${clay.pressSmall}`}
                    style={{ borderRadius: R.pill, background: CAT_COLORS.period.bg, boxShadow: S.raisedSoft }}>
                    <PencilSimple size={12} style={{ color: CAT_COLORS.period.shadow }} />
                  </button>
                  <button onClick={() => handleDelete(todayPeriod.id, '经期记录')} className={`p-1.5 ${clay.pressSmall}`}
                    style={{ borderRadius: R.pill, background: CAT_COLORS.period.bg, boxShadow: S.raisedSoft }}>
                    <Trash size={12} style={{ color: CAT_COLORS.period.shadow }} />
                  </button>
                </div>
              </div>
            </div>
          )}

          {todaySymptom && (
            <div className="mb-3" style={{ ...clay.cardViolet, padding: '14px 16px' }}>
              <div className="flex items-center gap-3">
                <div style={{ width: 36, height: 36, borderRadius: R.small, background: CAT_COLORS.symptom.shadow, display: 'flex', alignItems: 'center', justifyContent: 'center', color: F.surfaceRaised, fontSize: '13px', fontWeight: 700, flexShrink: 0 }}><Bandaids size={18} weight="fill" /></div>
                <div className="flex-1 min-w-0">
                  <span style={{ fontSize: '14px', fontWeight: 600, color: CAT_COLORS.symptom.fg }}>症状</span>
                  <span className="ml-1" style={{ fontSize: '13px', fontWeight: 400, color: `${CAT_COLORS.symptom.fg}99` }}>{todaySymptom.symptoms.join('、')}</span>
                </div>
                <div className="flex gap-1 shrink-0">
                  <button onClick={() => startEditSymptom(todaySymptom)} className={`p-1.5 ${clay.pressSmall}`}
                    style={{ borderRadius: R.pill, background: CAT_COLORS.symptom.bg, boxShadow: S.raisedSoft }}>
                    <PencilSimple size={12} style={{ color: CAT_COLORS.symptom.shadow }} />
                  </button>
                  <button onClick={() => handleDelete(todaySymptom.id, '症状记录')} className={`p-1.5 ${clay.pressSmall}`}
                    style={{ borderRadius: R.pill, background: CAT_COLORS.period.bg, boxShadow: S.raisedSoft }}>
                    <Trash size={12} style={{ color: CAT_COLORS.period.shadow }} />
                  </button>
                </div>
              </div>
            </div>
          )}

          {todayEvents.length === 0 && (
            <div className="flex items-center justify-center gap-2 mt-4"
              style={{ background: F.surfaceSunken, borderRadius: R.bigCard, boxShadow: S.sunken, padding: '20px 24px' }}>
              <Plus size={18} weight="regular" style={{ color: F.textTertiary, flexShrink: 0 }} />
              <span style={{ fontSize: '13px', color: F.textTertiary }}>
                {todayViewOffset === 0 ? '今日暂无记录' : '当日暂无记录'}
              </span>
            </div>
          )}
        </div>
      )}

      {/* ════════════════════════════════════════════════════
          Record Modal
      ════════════════════════════════════════════════════ */}
      {recordMode && (
        <div className="absolute inset-0 bg-black/15 backdrop-blur-sm z-50 flex items-end"
          onClick={(e) => { if (e.target === e.currentTarget) closeRecord(); }}>
          <div className="w-full px-5 pt-2 flex flex-col"
            style={{
              paddingBottom: 'calc(1.5rem + var(--safe-bottom))', /* [EM: safe-bottom] 原 pb-10 */
              background: clay.bg, borderRadius: `${R.sheet}px ${R.sheet}px 0 0`,
              boxShadow: S.floating,
              height: `${modalHeight}px`,
              transition: isDraggingModal ? 'none' : 'height 0.25s ease',
            }}>

            {/* 拖拽把手 — 仅训练/饮食可拖高 */}
            {(recordMode === 'workout' || recordMode === 'diet') ? (
              <div className="shrink-0 py-1.5 -mx-5 px-5 flex justify-center cursor-grab active:cursor-grabbing"
                style={{ touchAction: 'none' }}
                onPointerDown={(e) => {
                  const overlay = (e.currentTarget.closest('.absolute.inset-0') as HTMLElement);
                  modalDragRef.current = {
                    startY: e.clientY, startH: modalHeight,
                    maxH: overlay ? Math.round(overlay.clientHeight * 0.85) : 700,
                  };
                  setIsDraggingModal(true);
                  e.currentTarget.setPointerCapture(e.pointerId);
                }}
                onPointerMove={(e) => {
                  if (!isDraggingModal) return;
                  const { startY, startH, maxH } = modalDragRef.current;
                  setModalHeight(Math.min(maxH, Math.max(MODAL_BASE_H, startH + (startY - e.clientY))));
                }}
                onPointerUp={() => {
                  setIsDraggingModal(false);
                  // 松手吸附到最近的档位（默认高 / 85%）
                  const { maxH } = modalDragRef.current;
                  setModalHeight(h => (h - MODAL_BASE_H < (maxH - MODAL_BASE_H) / 2 ? MODAL_BASE_H : maxH));
                }}>
                <div className="w-10 h-1 rounded-full" style={{ background: F.borderStrong }} />
              </div>
            ) : (
              <div className="shrink-0 h-3" />
            )}

            <div className="flex items-center justify-between mb-4 shrink-0">
            <span className="text-base font-bold" style={{ color: F.textPrimary }}>{editingId ? '编辑记录' : '新记录'}</span>
              <button onClick={closeRecord} className={`w-7 h-7 flex items-center justify-center ${clay.pressSmall}`}
                style={{ background: F.surfaceRaised, borderRadius: R.pill, boxShadow: S.raisedSoft }}>
                <X size={14} style={{ color: F.textTertiary }} />
              </button>
            </div>

            {/* 5-tab selector — category colored */}
            <div className="flex gap-1 mb-4 p-1 shrink-0"
              style={{ background: F.surfaceSunken, borderRadius: R.sheet }}>
              {TAB_ORDER.map(tab => {
                const c = CAT_COLORS[tab.id];
                const isActive = recordMode === tab.id;
                return (
                  <button key={tab.id}
                    onClick={() => openRecord(tab.id)}
                    className={`flex-1 py-2 text-xs transition-all duration-150`}
                    style={{
                      borderRadius: R.pill,
                      background: isActive ? c.active : 'transparent',
                      color: isActive ? F.surfaceRaised : F.textTertiary,
                      fontWeight: isActive ? 600 : 400,
                      boxShadow: isActive ? S.raisedMedium : 'none',
                    }}>
                    {tab.label}
                  </button>
                );
              })}
            </div>

            {/* Content — flex-1 fills remaining space */}
            <div className="flex-1 overflow-y-auto">

              {/* ── Workout ── */}
              {recordMode === 'workout' && (
                <div className="flex flex-col h-full">
                <span className="text-xs font-bold uppercase tracking-wider" style={{ color: F.textTertiary }}>运动项目</span>
                  <div className="flex flex-wrap gap-1.5 mt-1.5">
                    {WORKOUT_ACTIVITIES.map(act => {
                      const on = workoutActivities.includes(act);
                      return (
                        <button key={act}
                          onClick={() => setWorkoutActivities(prev => on ? prev.filter(x => x !== act) : [...prev, act])}
                          className={`px-3 py-1.5 text-xs transition-all duration-150 ${clay.pressSmall}`}
                          style={{
                            borderRadius: R.pill,
                            background: on ? CAT_COLORS.workout.active : F.surfaceRaised,
                            color: on ? F.surfaceRaised : F.textTertiary,
                            fontWeight: on ? 600 : 400,
                            boxShadow: on ? S.raisedMedium : S.raisedSoft,
                          }}>
                          {act}
                        </button>
                      );
                    })}
                  </div>

                  {workoutActivities.includes('力量') && (
                    <>
                    <span className="text-xs font-bold uppercase tracking-wider mt-3" style={{ color: F.textTertiary }}>训练部位</span>
                      <div className="flex flex-wrap gap-1.5 mt-1.5">
                        {WORKOUT_PARTS.map(part => {
                          const on = workoutParts.includes(part);
                          return (
                            <button key={part}
                              onClick={() => setWorkoutParts(prev => on ? prev.filter(x => x !== part) : [...prev, part])}
                              className={`px-3 py-1.5 text-xs transition-all duration-150 ${clay.pressSmall}`}
                              style={{
                                borderRadius: R.pill,
                                background: on ? CAT_COLORS.workout.bg : F.surfaceRaised,
                                color: on ? CAT_COLORS.workout.fg : F.textTertiary,
                                fontWeight: on ? 600 : 400,
                                boxShadow: S.raisedSoft,
                              }}>
                              {part}
                            </button>
                          );
                        })}
                      </div>
                    </>
                  )}

                  <div className="flex gap-3 mt-3">
                    <div className="flex-1">
                    <span className="text-xs font-bold" style={{ color: F.textTertiary }}>消耗热量</span>
                      <input type="number" value={workoutCalories} onChange={e => setWorkoutCalories(e.target.value ? Number(e.target.value) : '')}
                        placeholder="kcal"
                          className="mt-1 w-full px-4 py-2.5 text-sm focus:outline-none" style={{ color: F.textPrimary, background: F.surfaceSunken, borderRadius: R.bigCard, boxShadow: S.sunken }} />
                    </div>
                    <div className="flex-1">
                    <span className="text-xs font-bold" style={{ color: F.textTertiary }}>时长（分钟）</span>
                      <input type="number" value={workoutDuration} onChange={e => setWorkoutDuration(e.target.value ? Number(e.target.value) : '')}
                        placeholder="60"
                          className="mt-1 w-full px-4 py-2.5 text-sm focus:outline-none" style={{ color: F.textPrimary, background: F.surfaceSunken, borderRadius: R.bigCard, boxShadow: S.sunken }} />
                    </div>
                  </div>

                  <span className="text-xs font-bold uppercase tracking-wider mt-3" style={{ color: F.textTertiary }}>备注（可选）</span>
                  <textarea value={recordText} onChange={e => setRecordText(e.target.value)}
                    placeholder="杠铃划船三组、深蹲三组..."
                      className="mt-1.5 w-full px-4 py-3 text-sm placeholder:text-[#9E9891] resize-none focus:outline-none leading-relaxed" style={{ color: F.textPrimary, background: F.surfaceSunken, borderRadius: R.input, boxShadow: S.sunken, border: `1px solid ${F.borderSoft}`, minHeight: '60px' }} />

                  <button onClick={handleSubmitWorkout} disabled={(workoutActivities.length === 0 && !recordText.trim() && !workoutCalories) || isSubmitting}
                    className={`w-full shrink-0 text-white font-bold py-3.5 mt-4 disabled:opacity-40 ${clay.press}`}
                    style={{ background: CAT_COLORS.workout.active, borderRadius: R.pill, boxShadow: S.raisedMedium }}>
                    保存
                  </button>
                </div>
              )}

              {/* ── Sleep ── */}
              {recordMode === 'sleep' && (
                <div className="flex flex-col h-full">
                <span className="text-xs font-bold uppercase tracking-wider" style={{ color: F.textTertiary }}>入睡 / 起床时间</span>
                  <div className="flex gap-3 mt-2 items-end">
                    <div className="flex-1">
                    <label className="text-[10px]" style={{ color: F.textTertiary }}>入睡</label>
                      <input type="time" value={sleepBedtime} onChange={e => setSleepBedtime(e.target.value)}
                        className="w-full px-3 py-2.5 text-center text-base font-bold focus:outline-none" style={{ color: F.textPrimary, background: F.surfaceSunken, borderRadius: R.bigCard, boxShadow: S.sunken }} />
                    </div>
                    <span className="pb-3" style={{ color: F.textTertiary }}>→</span>
                    <div className="flex-1">
                    <label className="text-[10px]" style={{ color: F.textTertiary }}>起床</label>
                      <input type="time" value={sleepWakeTime} onChange={e => setSleepWakeTime(e.target.value)}
                        className="w-full px-3 py-2.5 text-center text-base font-bold focus:outline-none" style={{ color: F.textPrimary, background: F.surfaceSunken, borderRadius: R.bigCard, boxShadow: S.sunken }} />
                    </div>
                  </div>
                  <div className="text-center py-3">
                    <span className="text-2xl font-bold" style={{ color: F.textPrimary }}>{fmtDuration(calcSleepMinutes(sleepBedtime, sleepWakeTime))}</span>
                    <p className="text-[10px] mt-1" style={{ color: F.textTertiary }}>睡眠时长</p>
                  </div>

                  <span className="text-xs font-bold uppercase tracking-wider mt-2" style={{ color: F.textTertiary }}>睡眠质量</span>
                  <div className="flex gap-2 mt-1.5">
                    {(['good','ok','poor'] as SleepQuality[]).map(q => (
                      <button key={q} onClick={() => setSleepQuality(q)}
                        className={`flex-1 py-2 text-xs font-bold ${clay.pressSmall}`}
                        style={{
                          borderRadius: R.pill,
                          background: sleepQuality === q ? CAT_COLORS.sleep.active : F.surfaceRaised,
                          color: sleepQuality === q ? F.surfaceRaised : F.textSecondary,
                          fontWeight: sleepQuality === q ? 600 : 400,
                          boxShadow: sleepQuality === q ? S.raisedMedium : S.raisedSoft,
                        }}>
                        {QUALITY_LABEL[q]}
                      </button>
                    ))}
                  </div>

                  <span className="text-xs font-bold uppercase tracking-wider mt-4" style={{ color: F.textTertiary }}>备注（可选）</span>
                  <input value={sleepNote} onChange={e => setSleepNote(e.target.value)} placeholder="做梦、失眠..."
                    className="mt-1.5 w-full px-4 py-2.5 text-sm focus:outline-none" style={{ color: F.textPrimary, background: F.surfaceSunken, borderRadius: R.bigCard, boxShadow: S.sunken }} />

                  <button onClick={handleSubmitSleep} disabled={isSubmitting}
                    className={`w-full text-white font-bold py-3.5 mt-4 disabled:opacity-50 ${clay.press}`}
                    style={{ background: CAT_COLORS.sleep.active, borderRadius: R.pill, boxShadow: S.raisedMedium }}>
                    保存
                  </button>
                </div>
              )}

              {/* ── Diet ── */}
              {recordMode === 'diet' && (
                <div className="flex flex-col h-full">
                <span className="text-xs font-bold uppercase tracking-wider" style={{ color: F.textTertiary }}>描述今天吃了什么</span>
                  <textarea value={dietText}
                    onChange={e => {
                      setDietText(e.target.value); setDietParsed(false);
                      if (!editingId) saveDietDraft(periodDate, e.target.value); // 实时存草稿，关弹窗不丢
                    }}
                    placeholder="随手记：包子两个、麻辣烫...（晚上一起估算）"
                      className="mt-1.5 w-full px-4 py-3 text-sm placeholder:text-[#9E9891] resize-none focus:outline-none leading-relaxed" style={{ color: F.textPrimary, background: F.surfaceSunken, borderRadius: R.input, boxShadow: S.sunken, border: `1px solid ${F.borderSoft}`, minHeight: '80px' }} />

                  <div className="flex gap-2 mt-2">
                    <button onClick={handleDietEstimate} disabled={!dietText.trim() || isSubmitting}
                      className={`flex-1 text-white font-bold py-2.5 text-sm disabled:opacity-50 ${clay.press}`}
                      style={{ background: CAT_COLORS.diet.active, borderRadius: R.pill, boxShadow: S.raisedMedium }}>
                      {isSubmitting ? '估算中…' : 'AI 估算'}
                    </button>
                    <div className="relative">
                      <button onClick={() => setShowCameraMenu(!showCameraMenu)}
                        className={`w-11 h-[42px] flex items-center justify-center ${clay.pressSmall}`}
                        style={{ background: CAT_COLORS.diet.bg, borderRadius: R.pill, boxShadow: S.raisedSoft }}>
                        <Camera size={18} weight="bold" style={{ color: HUE.amber.ink }} />
                      </button>
                      {showCameraMenu && (
                        <div className="absolute bottom-full right-0 mb-2 py-1 w-32 z-10"
                          style={{ background: F.surfaceRaised, borderRadius: R.bigCard, boxShadow: S.raisedSoft }}>
                          <label className="flex items-center gap-2 px-3 py-2.5 text-xs font-medium cursor-pointer" style={{ color: F.textPrimary }}>
                            拍照
                            <input type="file" accept="image/*" capture="environment" className="hidden" onChange={handleImageInput} />
                          </label>
                          <label className="flex items-center gap-2 px-3 py-2.5 text-xs font-medium cursor-pointer" style={{ color: F.textPrimary }}>
                            从相册选择
                            <input type="file" accept="image/*" className="hidden" onChange={handleImageInput} />
                          </label>
                          <label className="flex items-center gap-2 px-3 py-2.5 text-xs font-medium cursor-pointer" style={{ color: F.textPrimary }}>
                            上传文件
                            <input type="file" className="hidden" onChange={handleImageInput} />
                          </label>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Macro panel — 常驻可手填，AI 估算后自动填充 */}
                  <div className="mt-3 p-3" style={clay.cardAmber}>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-bold" style={{ color: HUE.amber.ink }}>
                        {dietParsed && !editingId ? '估算结果 · 可修改' : '营养数据（可手填）'}
                      </span>
                      {dietParsed && !editingId && (
                        <button onClick={handleDietEstimate} className="text-[10px]" style={{ color: HUE.amber.main }}>重新估算</button>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {([
                        { label: '总热量', val: dietCalories, set: setDietCalories, unit: 'kcal', color: HUE.amber.ink },
                        { label: '蛋白质', val: dietProtein,  set: setDietProtein,  unit: 'g', color: HUE.teal.ink },
                        { label: '碳水',   val: dietCarbs,    set: setDietCarbs,    unit: 'g', color: HUE.amber.main },
                        { label: '脂肪',   val: dietFat,      set: setDietFat,      unit: 'g', color: STATUS.danger.main },
                      ] as const).map(f => (
                        <div key={f.label} className="flex items-baseline gap-1">
                        <span className="text-[10px] w-10" style={{ color: F.textTertiary }}>{f.label}</span>
                          <input type="number" value={f.val} onChange={e => f.set(e.target.value ? Number(e.target.value) : '')}
                            placeholder="—"
                            className="w-14 text-sm font-bold text-right focus:outline-none"
                            style={{ background: 'transparent', color: f.color, border: 'none' }} />
                            <span className="text-[10px]" style={{ color: F.textTertiary }}>{f.unit}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <span className="text-xs font-bold uppercase tracking-wider mt-4" style={{ color: F.textTertiary }}>标签（可选）</span>
                  <input value={dietNote} onChange={e => setDietNote(e.target.value)} placeholder="早餐、午餐、晚餐..."
                    className="mt-1.5 w-full px-4 py-2.5 text-sm focus:outline-none" style={{ color: F.textPrimary, background: F.surfaceSunken, borderRadius: R.bigCard, boxShadow: S.sunken }} />

                  <button onClick={handleSubmitDiet} disabled={!dietCalories || isSubmitting}
                    className={`w-full text-white font-bold py-3.5 mt-4 disabled:opacity-40 ${clay.press}`}
                    style={{ background: CAT_COLORS.diet.active, borderRadius: R.pill, boxShadow: S.raisedMedium }}>
                    保存
                  </button>
                </div>
              )}

              {/* ── Period ── */}
              {recordMode === 'period' && (
                <div className="flex flex-col h-full">
                <span className="text-xs font-bold uppercase tracking-wider" style={{ color: F.textTertiary }}>经期量</span>
                  <div className="flex gap-2 mt-1.5">
                    {(['spotting','light','medium','heavy'] as PeriodFlow[]).map(f => (
                      <button key={f} onClick={() => setPeriodFlow(f)}
                        className={`flex-1 py-2 text-xs font-bold ${clay.pressSmall}`}
                        style={{
                          borderRadius: R.pill,
                          background: periodFlow === f ? CAT_COLORS.period.active : F.surfaceRaised,
                          color: periodFlow === f ? F.surfaceRaised : F.textSecondary,
                          fontWeight: periodFlow === f ? 600 : 400,
                          boxShadow: periodFlow === f ? S.raisedMedium : S.raisedSoft,
                        }}>
                        {FLOW_LABEL[f]}
                      </button>
                    ))}
                  </div>
                  <span className="text-xs font-bold uppercase tracking-wider mt-4" style={{ color: F.textTertiary }}>伴随症状（可选）</span>
                  <div className="flex flex-wrap gap-2 mt-1.5">
                    {PMS_SYMPTOMS.map(sym => {
                      const on = pmsSymptoms.includes(sym);
                      return (
                        <button key={sym}
                          onClick={() => setPmsSymptoms(prev => on ? prev.filter(x => x !== sym) : [...prev, sym])}
                          className={`px-3 py-1.5 text-xs font-semibold ${clay.pressSmall}`}
                          style={{
                            borderRadius: R.pill,
                            background: on ? CAT_COLORS.period.active : F.surfaceRaised,
                            color: on ? F.surfaceRaised : F.textSecondary,
                            fontWeight: on ? 600 : 400,
                            boxShadow: on ? S.raisedMedium : S.raisedSoft,
                          }}>
                          {sym}
                        </button>
                      );
                    })}
                  </div>
                  <button onClick={handleSubmitPeriod} disabled={(!periodFlow && pmsSymptoms.length === 0) || isSubmitting}
                    className={`w-full text-white font-bold py-3.5 mt-4 disabled:opacity-40 ${clay.press}`}
                    style={{ background: CAT_COLORS.period.active, borderRadius: R.pill, boxShadow: S.raisedMedium }}>
                    保存
                  </button>
                </div>
              )}

              {/* ── Symptom（身体不适） ── */}
              {recordMode === 'symptom' && (
                <div className="flex flex-col h-full">
                <span className="text-xs font-bold uppercase tracking-wider" style={{ color: F.textTertiary }}>身体不适（可多选）</span>
                  <div className="flex flex-wrap gap-2 mt-1.5">
                    {GENERAL_SYMPTOMS.map(sym => (
                      <button key={sym} onClick={() => toggleSymptom(sym)}
                        className={`px-3 py-1.5 text-xs font-semibold ${clay.pressSmall}`}
                        style={{
                          borderRadius: R.pill,
                          background: periodSymptoms.includes(sym) ? CAT_COLORS.symptom.active : F.surfaceRaised,
                          color: periodSymptoms.includes(sym) ? F.surfaceRaised : F.textSecondary,
                          fontWeight: periodSymptoms.includes(sym) ? 600 : 400,
                          boxShadow: periodSymptoms.includes(sym) ? S.raisedMedium : S.raisedSoft,
                        }}>
                        {sym}
                      </button>
                    ))}
                  </div>
                  <p className="text-[10px] mt-2" style={{ color: F.textTertiary }}>经期相关症状（痛经等）在经期 tab 里记录</p>
                  <button onClick={handleSubmitSymptom} disabled={(periodSymptoms.length === 0 && !editingId) || isSubmitting}
                    className={`w-full text-white font-bold py-3.5 mt-4 disabled:opacity-40 ${clay.press}`}
                    style={{ background: CAT_COLORS.symptom.active, borderRadius: R.pill, boxShadow: S.raisedMedium }}>
                    保存
                  </button>
                </div>
              )}

            </div>
          </div>
        </div>
      )}
      {/* ════════════════════════════════════════════════════
          Profile Setup Modal
      ════════════════════════════════════════════════════ */}
      {showProfileSetup && (
        <div className="absolute inset-0 bg-black/15 backdrop-blur-sm z-50 flex items-center justify-center"
          onClick={(e) => { if (e.target === e.currentTarget && profile) setShowProfileSetup(false); }}>
          <div className="w-[85%] max-w-xs p-5 flex flex-col gap-3 max-h-[80vh] overflow-y-auto"
            style={{ background: clay.bg, borderRadius: R.sheet, boxShadow: S.raisedSoft }}>

            <span className="text-base font-bold" style={{ color: F.textPrimary }}>健康档案</span>
            <p className="text-[11px] -mt-1" style={{ color: F.textTertiary }}>用于计算基础代谢率(BMR)，数据仅存本地</p>

            <div className="flex gap-3">
              <div className="flex-1">
              <span className="text-[10px]" style={{ color: F.textTertiary }}>身高(cm)</span>
                <input type="number" value={pfHeight} onChange={e => setPfHeight(e.target.value ? Number(e.target.value) : '')}
                placeholder="165" className="mt-1 w-full px-3 py-2 text-sm font-bold focus:outline-none" style={{ color: F.textPrimary, background: F.surfaceSunken, borderRadius: R.bigCard, boxShadow: S.sunken }} />
              </div>
              <div className="flex-1">
              <span className="text-[10px]" style={{ color: F.textTertiary }}>体重(kg)</span>
                <input type="number" step="0.1" value={pfWeight} onChange={e => setPfWeight(e.target.value ? Number(e.target.value) : '')}
                placeholder="55" className="mt-1 w-full px-3 py-2 text-sm font-bold focus:outline-none" style={{ color: F.textPrimary, background: F.surfaceSunken, borderRadius: R.bigCard, boxShadow: S.sunken }} />
              </div>
            </div>

            <div className="flex gap-3">
              <div className="flex-1">
              <span className="text-[10px]" style={{ color: F.textTertiary }}>年龄</span>
                <input type="number" value={pfAge} onChange={e => setPfAge(e.target.value ? Number(e.target.value) : '')}
                placeholder="24" className="mt-1 w-full px-3 py-2 text-sm font-bold focus:outline-none" style={{ color: F.textPrimary, background: F.surfaceSunken, borderRadius: R.bigCard, boxShadow: S.sunken }} />
              </div>
              <div className="flex-1">
              <span className="text-[10px]" style={{ color: F.textTertiary }}>性别</span>
                <div className="flex gap-1.5 mt-1">
                  {(['F', 'M'] as const).map(s => (
                    <button key={s} onClick={() => setPfSex(s)}
                      className={`flex-1 py-2 text-xs font-bold ${clay.pressSmall}`}
                      style={{
                        borderRadius: R.pill,
                        background: pfSex === s ? HUE.blue.main : F.surfaceRaised,
                        color: pfSex === s ? F.surfaceRaised : F.textSecondary,
                        boxShadow: pfSex === s ? S.raisedMedium : S.raisedSoft,
                      }}>
                      {s === 'F' ? '女' : '男'}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div>
            <span className="text-[10px]" style={{ color: F.textTertiary }}>体脂率 %（可选，有的话 BMR 更准）</span>
              <input type="number" step="0.1" value={pfBf} onChange={e => setPfBf(e.target.value ? Number(e.target.value) : '')}
              placeholder="如 22.5" className="mt-1 w-full px-3 py-2 text-sm font-bold focus:outline-none" style={{ color: F.textPrimary, background: F.surfaceSunken, borderRadius: R.bigCard, boxShadow: S.sunken }} />
            </div>

            <div className="h-px" style={{ background: F.divider }} />

            <div>
            <span className="text-[10px]" style={{ color: F.textTertiary }}>目标</span>
              <div className="flex gap-1.5 mt-1">
                {([
                  { id: 'maintain' as FitnessGoal, label: '维持' },
                  { id: 'cut'      as FitnessGoal, label: '减脂' },
                  { id: 'bulk'     as FitnessGoal, label: '增肌' },
                ]).map(g => (
                  <button key={g.id} onClick={() => {
                    setPfGoal(g.id);
                    if (pfHeight && pfWeight && pfAge) {
                      const b = calcBMR({ heightCm: Number(pfHeight), weightKg: Number(pfWeight), age: Number(pfAge), sex: pfSex, bodyFatPct: pfBf ? Number(pfBf) : undefined });
                      setPfCalTarget(recommendCalories(b, g.id));
                    }
                  }}
                    className={`flex-1 py-2 text-xs font-bold ${clay.pressSmall}`}
                    style={{
                      borderRadius: R.pill,
                      background: pfGoal === g.id ? HUE.green.main : F.surfaceRaised,
                      color: pfGoal === g.id ? F.surfaceRaised : F.textSecondary,
                      boxShadow: pfGoal === g.id ? S.raisedMedium : S.raisedSoft,
                    }}>
                    {g.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex gap-3">
              <div className="flex-1">
              <span className="text-[10px]" style={{ color: F.textTertiary }}>每日摄入目标(kcal)</span>
                <input type="number" value={pfCalTarget} onChange={e => setPfCalTarget(e.target.value ? Number(e.target.value) : '')}
                  placeholder={pfHeight && pfWeight && pfAge ? String(recommendCalories(calcBMR({ heightCm: Number(pfHeight), weightKg: Number(pfWeight), age: Number(pfAge), sex: pfSex, bodyFatPct: pfBf ? Number(pfBf) : undefined }), pfGoal)) : '1800'}
                    className="mt-1 w-full px-3 py-2 text-sm font-bold focus:outline-none" style={{ color: F.textPrimary, background: F.surfaceSunken, borderRadius: R.bigCard, boxShadow: S.sunken }} />
              </div>
            </div>

            <div className="flex gap-3">
              <div className="flex-1">
              <span className="text-[10px]" style={{ color: F.textTertiary }}>训练目标(kcal)</span>
                <input type="number" value={pfWorkoutTarget} onChange={e => setPfWorkoutTarget(e.target.value ? Number(e.target.value) : '')}
                  placeholder="500"
                    className="mt-1 w-full px-3 py-2 text-sm font-bold focus:outline-none" style={{ color: F.textPrimary, background: F.surfaceSunken, borderRadius: R.bigCard, boxShadow: S.sunken }} />
              </div>
              <div className="flex-1">
              <span className="text-[10px]" style={{ color: F.textTertiary }}>睡眠目标(小时)</span>
                <input type="number" step="0.5" value={pfSleepTarget} onChange={e => setPfSleepTarget(e.target.value ? Number(e.target.value) : '')}
                  placeholder="8"
                    className="mt-1 w-full px-3 py-2 text-sm font-bold focus:outline-none" style={{ color: F.textPrimary, background: F.surfaceSunken, borderRadius: R.bigCard, boxShadow: S.sunken }} />
              </div>
            </div>

            <button onClick={handleSaveProfile} disabled={!pfHeight || !pfWeight || !pfAge}
              className={`w-full text-white font-bold py-3 mt-1 disabled:opacity-40 ${clay.press}`}
              style={{ background: F.accent, borderRadius: R.pill, boxShadow: S.raisedMedium }}>
              保存
            </button>

            <div className="h-px mt-2" style={{ background: F.divider }} />

            <button onClick={() => { addToast('导入功能开发中', 'info'); }}
              className={`w-full font-medium py-2.5 text-xs ${clay.pressSmall}`}
              style={{ color: F.textSecondary, background: F.surfaceRaised, borderRadius: R.pill, boxShadow: S.raisedSoft }}>
              导入 Apple Health 数据
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default HealthApp;
