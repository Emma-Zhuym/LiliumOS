


import React, { useState, useEffect, useMemo } from 'react';
import { useOS } from '../context/OSContext';
import { DB } from '../utils/db';
import { Task, Anniversary, AgendaItem, CharacterProfile } from '../types';
import Modal from '../components/os/Modal';
import { ContextBuilder } from '../utils/context';
import { safeResponseJson } from '../utils/safeApi';
import { sortAnniversariesByNextOccurrence } from '../utils/anniversaryNext';
import { injectMemoryPalace } from '../utils/memoryPalace/pipeline';
import { CharacterGroupFilterBar, filterCharactersByGroup, GROUP_FILTER_ALL } from '../components/character/CharacterGroupFilter';
import { getCalendarDayDifference, getLocalDateKey } from '../utils/localDate';
import { useLocalDateKey } from '../hooks/useLocalDateKey';
import TokenImg from '../components/os/TokenImg';

const TWEMOJI_BASE = 'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72';
const twemojiUrl = (codepoint: string) => `${TWEMOJI_BASE}/${codepoint}.png`;

type ThemeMode = 'cyber' | 'soft' | 'minimal';

const THEMES: Record<ThemeMode, any> = {
    cyber: {
        id: 'cyber',
        bg: 'bg-[#0f172a]',
        text: 'text-slate-200',
        textSub: 'text-slate-500',
        accent: 'text-cyan-400',
        border: 'border-cyan-900/30',
        card: 'bg-slate-900/50 backdrop-blur-md border border-slate-700/50',
        buttonPrimary: 'bg-cyan-600 hover:bg-cyan-500 text-white rounded-none skew-x-[-10deg]',
        font: 'font-mono',
        iconDone: 'text-green-500',
        decoLine: 'bg-slate-800',
        modalBg: 'bg-[#0f172a] border border-cyan-500',
        input: 'bg-slate-800 text-white border-none rounded-none',
        label: 'QUEST',
        eventLabel: 'EVENTS',
        agendaLabel: 'DISPATCH',
    },
    soft: {
        id: 'soft',
        bg: 'bg-[#fff0f5]',
        text: 'text-slate-700',
        textSub: 'text-slate-400',
        accent: 'text-pink-500',
        border: 'border-pink-100',
        card: 'bg-white/80 backdrop-blur-xl rounded-[2rem] shadow-sm border border-white',
        buttonPrimary: 'bg-pink-400 hover:bg-pink-500 text-white rounded-2xl shadow-lg shadow-pink-200',
        font: 'font-sans',
        iconDone: 'text-pink-400',
        decoLine: 'bg-pink-200',
        modalBg: 'bg-white/90 rounded-[2.5rem]',
        input: 'bg-pink-50 text-slate-700 border border-pink-100 rounded-xl',
        label: '✨ 心愿单',
        eventLabel: '📅 纪念日',
        agendaLabel: '💌 约定',
    },
    minimal: {
        id: 'minimal',
        bg: 'bg-[#eef2f6]',
        text: 'text-slate-600',
        textSub: 'text-slate-400',
        accent: 'text-indigo-500',
        border: 'border-transparent',
        card: 'bg-[#eef2f6] rounded-2xl shadow-[6px_6px_12px_#d1d9e6,-6px_-6px_12px_#ffffff]',
        buttonPrimary: 'bg-[#eef2f6] text-slate-600 font-bold rounded-xl shadow-[6px_6px_12px_#d1d9e6,-6px_-6px_12px_#ffffff] active:shadow-[inset_4px_4px_8px_#d1d9e6,inset_-4px_-4px_8px_#ffffff]',
        font: 'font-sans',
        iconDone: 'text-slate-400',
        decoLine: 'bg-slate-300',
        modalBg: 'bg-[#eef2f6] rounded-2xl shadow-2xl',
        input: 'bg-[#eef2f6] text-slate-700 rounded-xl shadow-[inset_2px_2px_5px_#d1d9e6,inset_-2px_-2px_5px_#ffffff]',
        label: 'Focus',
        eventLabel: 'Timeline',
        agendaLabel: 'Agenda',
    },
};

// ---- helpers ----

const DAY_LABELS = ['日', '一', '二', '三', '四', '五', '六'];
const MONTH_NAMES = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];

const REMINDER_OPTIONS: { label: string; value: number | null }[] = [
    { label: '不提醒', value: null },
    { label: '准时', value: 0 },
    { label: '15分钟前', value: 15 },
    { label: '30分钟前', value: 30 },
];

const formatAgendaTime = (dateTimeStr: string): string => {
    const d = new Date(dateTimeStr);
    const month = d.getMonth() + 1;
    const day = d.getDate();
    const hours = d.getHours().toString().padStart(2, '0');
    const mins = d.getMinutes().toString().padStart(2, '0');
    return `${month}月${day}日 ${hours}:${mins}`;
};

const defaultDateTimeValue = (): string => {
    const d = new Date();
    d.setMinutes(d.getMinutes() + 60 - (d.getMinutes() % 60)); // round up to next hour
    return d.toISOString().slice(0, 16);
};

// ---- Component ----

const ScheduleApp: React.FC = () => {
    const { closeApp, characters, activeCharacterId, apiConfig, addToast, userProfile, characterGroups } = useOS();
    const localDateKey = useLocalDateKey();
    const [tasks, setTasks] = useState<Task[]>([]);
    const [anniversaries, setAnniversaries] = useState<Anniversary[]>([]);
    const [agendaItems, setAgendaItems] = useState<AgendaItem[]>([]);
    const [activeTab, setActiveTab] = useState<'quest' | 'server_events' | 'agenda'>('quest');

    const [processingTaskIds, setProcessingTaskIds] = useState<Set<string>>(new Set());

    const [currentThemeMode, setCurrentThemeMode] = useState<ThemeMode>('cyber');
    const theme = THEMES[currentThemeMode];

    // --- Modal states ---
    const [showTaskModal, setShowTaskModal] = useState(false);
    const [showAnniModal, setShowAnniModal] = useState(false);
    const [showAgendaModal, setShowAgendaModal] = useState(false);

    // --- Task form ---
    const [newTaskTitle, setNewTaskTitle] = useState('');
    const [newTaskSupervisor, setNewTaskSupervisor] = useState<string>(activeCharacterId || '');

    // --- Anniversary form ---
    const [newAnniTitle, setNewAnniTitle] = useState('');
    const [newAnniDate, setNewAnniDate] = useState('');
    const [newAnniChar, setNewAnniChar] = useState<string>(activeCharacterId || '');
    const [newAnniCharAware, setNewAnniCharAware] = useState(true);
    const [newAnniRepeatYearly, setNewAnniRepeatYearly] = useState(true);
    /** 非 null 时表示正在编辑已有纪念日 */
    const [editingAnniId, setEditingAnniId] = useState<string | null>(null);

    // --- Agenda form ---
    const [newAgendaTitle, setNewAgendaTitle] = useState('');
    const [newAgendaDateTime, setNewAgendaDateTime] = useState(defaultDateTimeValue);
    const [newAgendaChar, setNewAgendaChar] = useState<string>(activeCharacterId || '');
    const [newAgendaReminder, setNewAgendaReminder] = useState<number | null>(30);
    const [editingAgendaId, setEditingAgendaId] = useState<string | null>(null);

    // --- Calendar state ---
    const [calYear, setCalYear] = useState(() => new Date().getFullYear());
    const [calMonth, setCalMonth] = useState(() => new Date().getMonth());
    const [selectedCalDate, setSelectedCalDate] = useState<string | null>(null);

    // ---- Lifecycle ----
    const [supervisorGroupId, setSupervisorGroupId] = useState<string>(GROUP_FILTER_ALL); // 选监督人的分组筛选
    const [anniCharGroupId, setAnniCharGroupId] = useState<string>(GROUP_FILTER_ALL); // 纪念日关联对象的分组筛选

    useEffect(() => {
        loadData();
        const saved = localStorage.getItem('schedule_app_theme');
        if (saved && THEMES[saved as ThemeMode]) setCurrentThemeMode(saved as ThemeMode);
    }, []);

    const toggleTheme = () => {
        const modes: ThemeMode[] = ['cyber', 'soft', 'minimal'];
        const next = modes[(modes.indexOf(currentThemeMode) + 1) % modes.length];
        setCurrentThemeMode(next);
        localStorage.setItem('schedule_app_theme', next);
    };

    const loadData = async () => {
        const [t, a, ag] = await Promise.all([
            DB.getAllTasks(),
            DB.getAllAnniversaries(),
            DB.getAllAgenda(),
        ]);
        setTasks(t.sort((a, b) => b.createdAt - a.createdAt));
        setAnniversaries(a.sort((a, b) => a.date.localeCompare(b.date)));
        setAgendaItems(ag.sort((a, b) => (a.dateTime ?? '').localeCompare(b.dateTime ?? '')));
    };

    // ---- AI helpers ----

    const generateTaskReward = async (task: Task) => {
        const supervisor = characters.find(c => c.id === task.supervisorId);
        if (!supervisor || !apiConfig.apiKey) { addToast('任务已完成', 'success'); return; }
        addToast(`${supervisor.name} 正在确认你的成果...`, 'info');
        try {
            const baseContext = ContextBuilder.buildCoreContext(supervisor, userProfile);
            const userPrompt = `
### 场景：任务完成 (Task Completed)
用户 (${userProfile.name}) 刚刚在现实生活中完成了一个任务/契约： "${task.title}"。
你是监督人。

### 任务
请根据你的人设，对用户完成任务这一行为做出反应。
- 如果你是严厉的：勉强认可，或者催促下一个。
- 如果你是温柔的：给予温暖的夸奖。
- 如果你是傲娇的：别扭地表示一下。
- **关键**：不要问我用什么语气，**你自己**根据你的人设决定。

**输出要求**:
- 仅输出一句话（类似气泡通知）。
- **必须使用用户常用语言**。
- 不要有引号。`;
            const messages = [{ role: 'system', content: baseContext }, { role: 'user', content: userPrompt }];
            const response = await fetch(`${apiConfig.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiConfig.apiKey}` },
                body: JSON.stringify({ model: apiConfig.model, messages, temperature: 0.9, max_tokens: 8000 }),
            });
            if (!response.ok) throw new Error(`API Error ${response.status}`);
            const data = await safeResponseJson(response);
            let text = data.choices?.[0]?.message?.content?.trim();
            if (text) {
                text = text.replace(/^["']|["']$/g, '');
                addToast(`${supervisor.name}: ${text}`, 'success');
                await DB.saveMessage({
                    charId: supervisor.id, role: 'system', type: 'text',
                    content: `[系统: ${userProfile.name} 完成了任务 "${task.title}"。${supervisor.name} 评价道: "${text}"]`,
                });
            } else {
                addToast('任务完成 (AI 未返回评价)', 'success');
            }
        } catch (e: any) {
            console.error('Task Reward Error:', e);
            addToast(`评价生成失败: ${e.message}`, 'error');
        }
    };

    const generateAnniversaryThought = async (anni: Anniversary) => {
        const char = characters.find(c => c.id === anni.charId);
        if (!char || !apiConfig.apiKey) return;

        // Check cache (24h)
        if (anni.aiThought && anni.lastThoughtGeneratedAt && (Date.now() - anni.lastThoughtGeneratedAt < 24 * 60 * 60 * 1000)) {
            return;
        }

        // FEEDBACK: Show loading state if explicit call
        if (Date.now() - (anni.lastThoughtGeneratedAt || 0) > 10000) {
             addToast(`${char.name} 正在查阅日历...`, 'info');
        }

        const daysDiff = getCalendarDayDifference(getLocalDateKey(), anni.date) ?? 0;
        const dayText = daysDiff > 0 ? `还有 ${daysDiff} 天` : (daysDiff === 0 ? '就是今天!' : `已经过去 ${Math.abs(daysDiff)} 天了`);

        // RESTORED: Full context
        await injectMemoryPalace(char, undefined, anni.title);
        const baseContext = ContextBuilder.buildCoreContext(char, userProfile);
        const userPrompt = `
### 场景：纪念日提醒
事件: "${anni.title}"
时间状态: ${dayText}

### 任务
请根据你的人设，针对这个日期发表一句简短的感想。
**输出要求**:
- 仅输出一句话。
- **必须使用用户常用语言**。`;
        try {
            const response = await fetch(`${apiConfig.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiConfig.apiKey}` },
                body: JSON.stringify({ model: apiConfig.model, messages: [{ role: 'system', content: baseContext }, { role: 'user', content: userPrompt }], temperature: 0.8, max_tokens: 8000 }),
            });
            if (!response.ok) throw new Error(`API Error ${response.status}`);
            const data = await safeResponseJson(response);
            const text = data.choices?.[0]?.message?.content?.trim().replace(/^["']|["']$/g, '');
            if (text) {
                const updated = { ...anni, aiThought: text, lastThoughtGeneratedAt: Date.now() };
                await DB.saveAnniversary(updated);
                setAnniversaries(prev => prev.map(a => a.id === anni.id ? updated : a));
            }
        } catch (e: any) { console.error('Anniversary Thought Error:', e); }
    };

    // ---- Actions ----

    const handleAddTask = async () => {
        if (!newTaskTitle.trim()) return;
        const task: Task = { id: `task-${Date.now()}`, title: newTaskTitle, supervisorId: newTaskSupervisor || characters[0]?.id, tone: 'gentle', isCompleted: false, createdAt: Date.now() };
        await DB.saveTask(task);
        setTasks(prev => [task, ...prev]);
        setShowTaskModal(false);
        setNewTaskTitle('');
    };

    const handleToggleTask = async (task: Task) => {
        const updated = { ...task, isCompleted: !task.isCompleted, completedAt: !task.isCompleted ? Date.now() : undefined };
        await DB.saveTask(updated);
        setTasks(prev => prev.map(t => t.id === task.id ? updated : t));
        if (updated.isCompleted) {
            setProcessingTaskIds(prev => new Set(prev).add(task.id));
            try { await generateTaskReward(updated); }
            finally { setProcessingTaskIds(prev => { const n = new Set(prev); n.delete(task.id); return n; }); }
        }
    };

    const handleDeleteTask = async (id: string) => {
        await DB.deleteTask(id);
        setTasks(prev => prev.filter(t => t.id !== id));
    };

    const resetAnniForm = () => {
        setEditingAnniId(null);
        setNewAnniTitle('');
        setNewAnniDate('');
        setNewAnniCharAware(true);
        setNewAnniRepeatYearly(true);
        setNewAnniChar(activeCharacterId || characters[0]?.id || '');
    };

    const openEditAnniModal = (a: Anniversary) => {
        setEditingAnniId(a.id);
        setNewAnniTitle(a.title);
        setNewAnniDate(a.date);
        setNewAnniChar(a.charId);
        setNewAnniCharAware(a.charAware !== false);
        setNewAnniRepeatYearly(a.repeatYearly !== false);
        setShowAnniModal(true);
    };

    const handleSaveAnni = async () => {
        if (!newAnniTitle.trim() || !newAnniDate) return;
        const titleTrim = newAnniTitle.trim();
        const charId = newAnniChar || characters[0]?.id;
        if (!charId) return;

        if (editingAnniId) {
            const existing = anniversaries.find(x => x.id === editingAnniId);
            if (!existing) return;
            const contentChanged = existing.title !== titleTrim || existing.date !== newAnniDate;
            const updated: Anniversary = {
                ...existing,
                title: titleTrim,
                date: newAnniDate,
                charId,
                charAware: newAnniCharAware,
                repeatYearly: newAnniRepeatYearly,
            };
            if (contentChanged) {
                updated.aiThought = undefined;
                updated.lastThoughtGeneratedAt = undefined;
            }
            await DB.saveAnniversary(updated);
            setAnniversaries(prev => prev.map(x => (x.id === editingAnniId ? updated : x)).sort((a, b) => a.date.localeCompare(b.date)));
        } else {
            const anni: Anniversary = {
                id: `anni-${Date.now()}`,
                title: titleTrim,
                date: newAnniDate,
                charId,
                charAware: newAnniCharAware,
                repeatYearly: newAnniRepeatYearly,
            };
            await DB.saveAnniversary(anni);
            setAnniversaries(prev => [...prev, anni].sort((a, b) => a.date.localeCompare(b.date)));
        }
        setShowAnniModal(false);
        resetAnniForm();
    };

    const handleDeleteAnni = async (id: string) => {
        await DB.deleteAnniversary(id);
        setAnniversaries(prev => prev.filter(a => a.id !== id));
    };

    const resetAgendaForm = () => {
        setEditingAgendaId(null);
        setNewAgendaTitle('');
        setNewAgendaDateTime(defaultDateTimeValue());
        setNewAgendaChar(activeCharacterId || '');
        setNewAgendaReminder(30);
    };

    const openEditAgendaModal = (item: AgendaItem) => {
        setEditingAgendaId(item.id);
        setNewAgendaTitle(item.title);
        setNewAgendaDateTime(item.dateTime ?? '');
        setNewAgendaChar(item.charId ?? '');
        setNewAgendaReminder(item.reminderMinutes === undefined ? 30 : item.reminderMinutes);
        setShowAgendaModal(true);
    };

    const handleSaveAgenda = async () => {
        if (!newAgendaTitle.trim() || !newAgendaDateTime) return;
        const titleTrim = newAgendaTitle.trim();
        const reminder = newAgendaReminder;

        if (editingAgendaId) {
            const existing = agendaItems.find(x => x.id === editingAgendaId);
            if (!existing) return;
            const item: AgendaItem = {
                ...existing,
                title: titleTrim,
                dateTime: newAgendaDateTime,
                charId: newAgendaChar || undefined,
                reminderMinutes: reminder,
            };
            await DB.saveAgenda(item);
            setAgendaItems(prev => prev.map(a => (a.id === editingAgendaId ? item : a)).sort((x, y) => (x.dateTime ?? '').localeCompare(y.dateTime ?? '')));
            setShowAgendaModal(false);
            resetAgendaForm();
            if (reminder !== null) {
                scheduleAgendaReminder(item, reminder);
            }
        } else {
            const item: AgendaItem = {
                id: `agenda-${Date.now()}`,
                title: titleTrim,
                summary: '',
                dateTime: newAgendaDateTime,
                charId: newAgendaChar || undefined,
                reminderMinutes: reminder,
                createdAt: Date.now(),
            };
            await DB.saveAgenda(item);
            setAgendaItems(prev => [...prev, item].sort((a, b) => (a.dateTime ?? '').localeCompare(b.dateTime ?? '')));
            setShowAgendaModal(false);
            resetAgendaForm();
            if (reminder !== null) {
                scheduleAgendaReminder(item, reminder);
            }
        }
    };

    const scheduleAgendaReminder = async (item: AgendaItem, reminderMinutes: number) => {
        const dueAt = new Date(item.dateTime ?? '').getTime() - reminderMinutes * 60 * 1000;
        if (dueAt <= Date.now()) {
            addToast('约定时间太近，提醒已跳过', 'info');
            return;
        }
        const charId = item.charId || activeCharacterId || characters[0]?.id;
        if (!charId) return;

        const char = characters.find(c => c.id === charId);
        const timeDesc = reminderMinutes === 0 ? '马上就到' : `还有 ${reminderMinutes} 分钟`;

        // Fallback template (used if no API key or call fails)
          let content = timeDesc === '马上就到' ? `「${item.title}」时间到了！` : `「${item.title}」还有 ${reminderMinutes} 分钟，别忘了～`;

        // Try AI generation in char's voice
        if (char && apiConfig.apiKey) {
            try {
                const baseContext = ContextBuilder.buildCoreContext(char, userProfile, false);
                const prompt = `你和用户有一个约定，名称是「${item.title}」，${timeDesc}就要开始了。请用一句话提醒用户，必须提到「${item.title}」这个名称（可以缩短或化用，但不能完全忽略），符合你的性格，口语自然，不超过30字，不要有引号，不要自行猜测或扩写约定的具体内容。`;
                const response = await fetch(`${apiConfig.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiConfig.apiKey}` },
                    body: JSON.stringify({
                        model: apiConfig.model,
                        messages: [{ role: 'system', content: baseContext }, { role: 'user', content: prompt }],
                        temperature: 0.9,
                        max_tokens: 100,
                    }),
                });
                if (response.ok) {
                    const data = await safeResponseJson(response);
                    const text = data.choices?.[0]?.message?.content?.trim().replace(/^["']|["']$/g, '');
                    if (text) content = text;
                }
            } catch (e) { /* fall back to template */ }
        }

        await DB.saveScheduledMessage({
            id: `sched-agenda-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            charId,
            content,
            dueAt,
            createdAt: Date.now(),
        });

        const timeLabel = reminderMinutes === 0 ? '准时' : `提前 ${reminderMinutes} 分钟`;
        addToast(`提醒已设置（${timeLabel}）`, 'success');
    };

    const handleDeleteAgenda = async (id: string) => {
        await DB.deleteAgenda(id);
        setAgendaItems(prev => prev.filter(a => a.id !== id));
    };

    // ---- Render helpers ----

    const upcomingAnniRow = useMemo(() => {
        const sorted = sortAnniversariesByNextOccurrence(anniversaries);
        return sorted[0] ?? null;
    }, [anniversaries]);

    const upcomingAnni = upcomingAnniRow?.anni ?? null;

    const daysUntilUpcomingAnni = useMemo(() => {
        if (!upcomingAnniRow) return 0;
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        return Math.ceil((upcomingAnniRow.next.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    }, [upcomingAnniRow]);

    useEffect(() => { if (upcomingAnni) generateAnniversaryThought(upcomingAnni); }, [upcomingAnni]);

    // ---- Calendar logic ----

    const calFirstDow = useMemo(() => new Date(calYear, calMonth, 1).getDay(), [calYear, calMonth]);
    const calDaysInMonth = useMemo(() => new Date(calYear, calMonth + 1, 0).getDate(), [calYear, calMonth]);

    const markedCalDays = useMemo(() => {
        const set = new Set<number>();
        agendaItems.forEach(a => {
            const d = new Date(a.dateTime ?? '');
            if (d.getFullYear() === calYear && d.getMonth() === calMonth) set.add(d.getDate());
        });
        return set;
    }, [agendaItems, calYear, calMonth]);

    const todayDate = new Date();
    const isToday = (day: number) =>
        todayDate.getFullYear() === calYear && todayDate.getMonth() === calMonth && todayDate.getDate() === day;

    const handleCalDayClick = (day: number) => {
        const str = `${calYear}-${String(calMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        setSelectedCalDate(prev => (prev === str ? null : str));
    };

    const prevCalMonth = () => {
        if (calMonth === 0) { setCalYear(y => y - 1); setCalMonth(11); } else setCalMonth(m => m - 1);
        setSelectedCalDate(null);
    };
    const nextCalMonth = () => {
        if (calMonth === 11) { setCalYear(y => y + 1); setCalMonth(0); } else setCalMonth(m => m + 1);
        setSelectedCalDate(null);
    };

    // upcoming 3 or selected-day filter
    const visibleAgenda = useMemo(() => {
        if (selectedCalDate) {
            return agendaItems.filter(a => a.dateTime?.startsWith(selectedCalDate)).sort((a, b) => (a.dateTime ?? '').localeCompare(b.dateTime ?? ''));
        }
        const todayStr = new Date().toISOString().slice(0, 10); // YYYY-MM-DD，从今天零点开始
        return agendaItems.filter(a => (a.dateTime?.slice(0, 10) ?? '') >= todayStr).sort((a, b) => (a.dateTime ?? '').localeCompare(b.dateTime ?? '')).slice(0, 3);
    }, [agendaItems, selectedCalDate]);

    // ---- Tab button add handler ----
    const handleAddButton = () => {
        if (activeTab === 'quest') setShowTaskModal(true);
        else if (activeTab === 'server_events') {
            resetAnniForm();
            setShowAnniModal(true);
        } else {
            resetAgendaForm();
            setShowAgendaModal(true);
        }
    };

    // ---- Per-theme calendar cell classes ----
    const calTodayClass =
        currentThemeMode === 'cyber' ? 'bg-cyan-600 text-white rounded-full' :
        currentThemeMode === 'soft'  ? 'bg-pink-400 text-white rounded-full' :
                                       'shadow-[inset_2px_2px_5px_#d1d9e6,inset_-2px_-2px_5px_#ffffff] text-indigo-500 font-bold rounded-xl';
    const calSelectedClass =
        currentThemeMode === 'cyber' ? 'bg-cyan-900/70 text-cyan-300 rounded-full' :
        currentThemeMode === 'soft'  ? 'bg-pink-100 text-pink-600 rounded-full' :
                                       'shadow-[inset_1px_1px_3px_#d1d9e6,inset_-1px_-1px_3px_#ffffff] text-indigo-400 rounded-xl';
    const dotClass =
        currentThemeMode === 'cyber' ? 'bg-cyan-400' :
        currentThemeMode === 'soft'  ? 'bg-pink-400' : 'bg-indigo-400';

    return (
        <div className={`h-full w-full flex flex-col ${theme.font} ${theme.bg} ${theme.text} relative overflow-hidden transition-colors duration-500`}>

            {/* Cyber grid bg */}
            {currentThemeMode === 'cyber' && (
                <div className="absolute inset-0 pointer-events-none opacity-20"
                    style={{ backgroundImage: 'linear-gradient(rgba(56,189,248,0.1) 1px,transparent 1px),linear-gradient(90deg,rgba(56,189,248,0.1) 1px,transparent 1px)', backgroundSize: '40px 40px' }} />
            )}

            {/* Soft polka bg */}
            {currentThemeMode === 'soft' && (
                <div className="absolute inset-0 pointer-events-none opacity-30"
                    style={{ backgroundImage: 'radial-gradient(#fbcfe8 2px,transparent 2px)', backgroundSize: '20px 20px' }} />
            )}

            {/* ── Header ── (EM: 3 tabs incl. agenda; upstream: safe-top) */}
            <div className={`border-b ${theme.border} backdrop-blur-sm sticky top-0 z-20 shrink-0 relative transition-colors duration-300`} style={{ paddingTop: 'var(--safe-top)' }}>
                <div className="pt-12 pb-4 px-4 flex items-center justify-between h-24 box-border">

                <button onClick={closeApp} className={`p-2 -ml-1 rounded-full active:scale-90 transition-transform ${currentThemeMode === 'minimal' ? 'bg-[#eef2f6] shadow-[4px_4px_8px_#d1d9e6,-4px_-4px_8px_#ffffff]' : 'hover:bg-black/5'}`}>
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className={`w-5 h-5 ${theme.accent}`}><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" /></svg>
                </button>

                {/* Three tabs */}
                <div className={`flex gap-0.5 p-1 rounded-lg ml-3 ${currentThemeMode === 'cyber' ? 'bg-black/40 border border-cyan-900/50' : currentThemeMode === 'minimal' ? 'bg-[#eef2f6] shadow-[inset_2px_2px_5px_#d1d9e6,inset_-2px_-2px_5px_#ffffff]' : 'bg-white/50'}`}>
                    {(['quest', 'server_events', 'agenda'] as const).map(tab => {
                        const label = tab === 'quest' ? theme.label : tab === 'server_events' ? theme.eventLabel : theme.agendaLabel;
                        const isActive = activeTab === tab;
                        return (
                            <button
                                key={tab}
                                onClick={() => setActiveTab(tab)}
                                className={`px-4 py-1.5 rounded text-xs font-bold transition-all whitespace-nowrap ${
                                    isActive
                                        ? `${theme.accent} ${currentThemeMode === 'cyber' ? 'bg-cyan-900/50' : currentThemeMode === 'minimal' ? 'shadow-[2px_2px_5px_#d1d9e6,-2px_-2px_5px_#ffffff] bg-[#eef2f6]' : 'bg-white shadow-sm'}`
                                        : theme.textSub
                                }`}
                            >{label}</button>
                        );
                    })}
                </div>

                {/* Right: theme switcher + add */}
                <div className="flex items-center gap-1.5">
                    <button onClick={toggleTheme} className={`p-2 rounded-full active:scale-90 transition-transform ${currentThemeMode === 'minimal' ? 'shadow-[4px_4px_8px_#d1d9e6,-4px_-4px_8px_#ffffff]' : 'hover:bg-white/10'}`}>
                        <span className="text-base leading-none">
                            {currentThemeMode === 'cyber' && '👾'}
                            {currentThemeMode === 'soft' && '🌸'}
                            {currentThemeMode === 'minimal' && '⚪'}
                        </span>
                    </button>
                    <button onClick={handleAddButton} className={`p-2 rounded-full active:scale-90 transition-transform ${theme.accent} ${currentThemeMode === 'minimal' ? 'shadow-[4px_4px_8px_#d1d9e6,-4px_-4px_8px_#ffffff]' : 'hover:bg-white/10'}`}>
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
                    </button>
                </div>
                </div>

                {currentThemeMode === 'cyber' && <div className="absolute bottom-0 left-0 h-[1px] w-full bg-gradient-to-r from-transparent via-cyan-500/50 to-transparent" />}
            </div>

            {/* ── Content ── */}
            <div className="flex-1 overflow-y-auto no-scrollbar p-5 space-y-6 z-10">

                {/* Hero Anniversary Card */}
                {upcomingAnni && (
                    <div className={`w-full rounded-2xl p-5 relative overflow-hidden transition-all duration-300 ${currentThemeMode === 'minimal' ? 'bg-[#eef2f6] shadow-[inset_5px_5px_10px_#d1d9e6,inset_-5px_-5px_10px_#ffffff]' : currentThemeMode === 'soft' ? 'bg-gradient-to-r from-pink-300 to-purple-300 text-white shadow-lg shadow-pink-200' : 'bg-gradient-to-r from-slate-900 to-slate-800 border border-purple-500/30'}`}>
                        <button
                            type="button"
                            onClick={() => openEditAnniModal(upcomingAnni)}
                            className={`absolute top-3 right-3 z-10 p-1.5 rounded-lg text-sm opacity-60 hover:opacity-100 transition-opacity ${currentThemeMode === 'minimal' ? 'text-slate-500 hover:bg-black/5' : 'text-white/90 hover:bg-white/10'}`}
                            title="编辑此纪念日"
                        >
                            ✎
                        </button>
                        <div className="flex justify-between items-start mb-2 pr-8">
                            <div className={`text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded ${currentThemeMode === 'minimal' ? 'text-slate-400' : 'text-white/80 bg-white/20'}`}>即将到来</div>
                            <div className="text-3xl font-bold tracking-tighter">{daysUntilUpcomingAnni} <span className="text-xs opacity-60 font-normal">天后</span></div>
                        </div>
                        <div className="text-xl font-bold mb-4">{upcomingAnni.title}</div>
                        <div className={`flex items-start gap-3 p-3 rounded-xl ${currentThemeMode === 'minimal' ? 'bg-[#eef2f6] shadow-[5px_5px_10px_#d1d9e6,-5px_-5px_10px_#ffffff]' : 'bg-white/20 backdrop-blur-md'}`}>
                            <TokenImg value={characters.find(c => c.id === upcomingAnni.charId)?.avatar} className="w-8 h-8 rounded-full object-cover" />
                            <div className={`text-xs font-medium leading-relaxed italic ${currentThemeMode === 'minimal' ? 'text-slate-500' : 'text-white/90'}`}>"{upcomingAnni.aiThought || '加载中...'}"</div>
                        </div>
                    </div>
                )}

                {/* ── QUEST tab ── */}
                {activeTab === 'quest' && (
                    <div className="space-y-4">
                        <div className="flex items-center gap-2 mb-2 px-1">
                            <div className={`w-2 h-2 rounded-full animate-pulse ${currentThemeMode === 'cyber' ? 'bg-cyan-500' : currentThemeMode === 'soft' ? 'bg-pink-400' : 'bg-slate-400'}`} />
                            <h3 className={`text-xs font-bold uppercase tracking-[0.2em] ${theme.accent}`}>进行中任务</h3>
                        </div>

                        {tasks.filter(t => !t.isCompleted).length === 0 && (
                            <div className={`text-center py-12 border-2 border-dashed rounded-xl ${currentThemeMode === 'cyber' ? 'border-slate-800' : 'border-slate-200'}`}>
                                <div className={theme.textSub}>暂无任务</div>
                            </div>
                        )}

                        {tasks.filter(t => !t.isCompleted).map(task => {
                            const supervisor = characters.find(c => c.id === task.supervisorId);
                            const isProcessing = processingTaskIds.has(task.id);
                            return (
                                <div key={task.id} className={`${theme.card} p-4 flex items-center gap-4 group relative overflow-hidden transition-all duration-300`}>
                                    <div className="w-12 h-12 rounded-full overflow-hidden shrink-0 relative border border-white/10">
                                        {supervisor ? <TokenImg value={supervisor.avatar} className="w-full h-full object-cover opacity-90 group-hover:opacity-100 transition-opacity" /> : <span className="text-xs">?</span>}
                                        <div className={`absolute -bottom-0 -right-0 w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold ${currentThemeMode === 'soft' ? 'bg-white text-pink-500' : 'bg-black text-cyan-500'}`}>!</div>
                                    </div>
                                    <div className="flex-1">
                                        <div className={`${theme.text} font-bold text-sm tracking-wide`}>{task.title}</div>
                                        <div className={`text-[10px] ${theme.textSub} mt-1 font-mono uppercase`}>监督人: {supervisor?.name || 'Unknown'}</div>
                                    </div>
                                    {isProcessing ? (
                                        <div className="flex items-center gap-2 px-2 py-2">
                                            <div className={`w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin ${theme.accent}`} />
                                            <span className={`text-[10px] font-bold animate-pulse ${theme.accent}`}>验收中...</span>
                                        </div>
                                    ) : (
                                        <button onClick={() => handleToggleTask(task)} className={`px-4 py-2 text-[10px] font-bold uppercase tracking-wider rounded transition-all active:scale-95 ${currentThemeMode === 'minimal' ? 'shadow-[4px_4px_8px_#d1d9e6,-4px_-4px_8px_#ffffff] text-slate-500 active:shadow-[inset_2px_2px_5px_#d1d9e6,inset_-2px_-2px_5px_#ffffff]' : currentThemeMode === 'soft' ? 'bg-pink-100 text-pink-500' : 'bg-cyan-900/30 text-cyan-400 border border-cyan-800'}`}>完成</button>
                                    )}
                                    <button onClick={() => handleDeleteTask(task.id)} className="absolute top-2 right-2 text-slate-400 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity p-1">×</button>
                                </div>
                            );
                        })}

                        {tasks.filter(t => t.isCompleted).length > 0 && (
                            <div className="pt-8 opacity-50">
                                <h3 className={`text-xs font-bold uppercase tracking-[0.2em] px-1 mb-4 ${theme.textSub}`}>已完成</h3>
                                {tasks.filter(t => t.isCompleted).map(task => (
                                    <div key={task.id} className={`flex items-center gap-3 py-2 px-2 border-b ${currentThemeMode === 'cyber' ? 'border-slate-800/50' : 'border-slate-100'}`}>
                                        <div className={`${theme.iconDone} text-xs font-mono`}>[DONE]</div>
                                        <span className={`text-sm line-through ${theme.textSub}`}>{task.title}</span>
                                        <button onClick={() => handleDeleteTask(task.id)} className="ml-auto text-slate-400 hover:text-red-500 text-xs">DEL</button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {/* ── EVENTS tab ── */}
                {activeTab === 'server_events' && (
                    <div className={`relative pl-6 space-y-8 before:absolute before:left-2 before:top-2 before:bottom-0 before:w-[1px] ${theme.decoLine}`}>
                        <h3 className={`text-xs font-bold uppercase tracking-widest mb-6 -ml-6 pl-6 ${theme.textSub}`}>时间线事件</h3>
                        <div className="space-y-4">
                            {anniversaries.map(a => (
                                <div key={a.id} className="relative group">
                                    <div className={`absolute -left-[20px] top-4 w-2 h-2 rounded-full z-10 ${currentThemeMode === 'cyber' ? 'bg-black border border-purple-500' : 'bg-pink-400'}`} />
                                    <div className={`${theme.card} p-4 flex justify-between items-center gap-2 transition-colors`}>
                                        <button type="button" onClick={() => openEditAnniModal(a)} className="text-left flex-1 min-w-0">
                                            <div className={`text-sm font-bold ${theme.text}`}>{a.title}</div>
                                            <div className={`text-[10px] ${theme.textSub} font-mono mt-1`}>{a.date} · {characters.find(c => c.id === a.charId)?.name}</div>
                                        </button>
                                        <div className="flex items-center shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                                            <button
                                                type="button"
                                                onClick={() => openEditAnniModal(a)}
                                                className={`p-2 text-slate-400 ${currentThemeMode === 'cyber' ? 'hover:text-cyan-400' : currentThemeMode === 'soft' ? 'hover:text-pink-500' : 'hover:text-indigo-500'}`}
                                                title="编辑"
                                            >
                                                ✎
                                            </button>
                                            <button type="button" onClick={() => handleDeleteAnni(a.id)} className="text-slate-400 hover:text-red-400 p-2" title="删除">×</button>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* ── AGENDA tab ── */}
                {activeTab === 'agenda' && (
                    <div className="space-y-5">

                        {/* Mini Calendar */}
                        <div className={`${theme.card} p-4`}>
                            {/* Month navigation */}
                            <div className="flex items-center justify-between mb-3">
                                <button onClick={prevCalMonth} className={`p-1.5 rounded-full active:scale-90 transition-transform ${theme.textSub}`}>
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" /></svg>
                                </button>
                                <span className={`text-sm font-bold ${theme.text}`}>{calYear}年 {MONTH_NAMES[calMonth]}</span>
                                <button onClick={nextCalMonth} className={`p-1.5 rounded-full active:scale-90 transition-transform ${theme.textSub}`}>
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" /></svg>
                                </button>
                            </div>

                            {/* Day-of-week labels */}
                            <div className="grid grid-cols-7 mb-1">
                                {DAY_LABELS.map(d => (
                                    <div key={d} className={`text-center text-[10px] font-bold py-1 ${theme.textSub}`}>{d}</div>
                                ))}
                            </div>

                            {/* Day cells */}
                            <div className="grid grid-cols-7 gap-y-0.5">
                                {Array(calFirstDow).fill(null).map((_, i) => <div key={`e${i}`} />)}
                                {Array.from({ length: calDaysInMonth }, (_, i) => i + 1).map(day => {
                                    const dateStr = `${calYear}-${String(calMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                                    const hasItems = markedCalDays.has(day);
                                    const todayCell = isToday(day);
                                    const selectedCell = selectedCalDate === dateStr;
                                    return (
                                        <button
                                            key={day}
                                            onClick={() => handleCalDayClick(day)}
                                            className={`relative flex flex-col items-center justify-center py-1.5 text-xs transition-all active:scale-90 ${todayCell ? calTodayClass : selectedCell ? calSelectedClass : ''}`}
                                        >
                                            <span className={`text-xs font-medium leading-none ${todayCell || selectedCell ? '' : theme.text}`}>{day}</span>
                                            {hasItems && !todayCell && !selectedCell && (
                                                <div className={`w-1 h-1 rounded-full mt-0.5 ${dotClass}`} />
                                            )}
                                            {hasItems && (todayCell || selectedCell) && (
                                                <div className="w-1 h-1 rounded-full mt-0.5 bg-white/70" />
                                            )}
                                        </button>
                                    );
                                })}
                            </div>

                            {/* Selected date hint */}
                            {selectedCalDate && (
                                <div className={`mt-3 text-center text-[10px] ${theme.textSub}`}>
                                    {selectedCalDate.replace(/-/g, '/')} · 点击同一天取消筛选
                                </div>
                            )}
                        </div>

                        {/* Agenda list */}
                        <div>
                            <div className="flex items-center gap-2 px-1 mb-3">
                                <div className={`w-2 h-2 rounded-full animate-pulse ${dotClass}`} />
                                <h3 className={`text-xs font-bold uppercase tracking-[0.2em] ${theme.accent}`}>
                                    {selectedCalDate ? '当天约定' : '近期约定'}
                                </h3>
                            </div>

                            {visibleAgenda.length === 0 ? (
                                <div className={`text-center py-10 border-2 border-dashed rounded-xl ${currentThemeMode === 'cyber' ? 'border-slate-800' : 'border-slate-200'}`}>
                                    <div className={`text-sm ${theme.textSub}`}>{selectedCalDate ? '这一天暂无约定' : '暂无即将到来的约定'}</div>
                                </div>
                            ) : (
                                <div className="space-y-3">
                                    {visibleAgenda.map(item => {
                                        const char = characters.find(c => c.id === item.charId);
                                        return (
                                            <div key={item.id} className={`${theme.card} p-4 flex items-center gap-2 group relative overflow-hidden`}>
                                                <button
                                                    type="button"
                                                    onClick={() => openEditAgendaModal(item)}
                                                    className="flex flex-1 items-center gap-3 min-w-0 text-left"
                                                >
                                                    {char ? (
                                                        <img src={char.avatar} className="w-10 h-10 rounded-full object-cover shrink-0" alt="" />
                                                    ) : (
                                                        <div className={`w-10 h-10 rounded-full shrink-0 flex items-center justify-center text-lg ${currentThemeMode === 'cyber' ? 'bg-slate-800 text-cyan-400' : currentThemeMode === 'soft' ? 'bg-pink-100 text-pink-400' : 'bg-[#eef2f6] shadow-[3px_3px_6px_#d1d9e6,-3px_-3px_6px_#ffffff] text-slate-400'}`}>📅</div>
                                                    )}
                                                    <div className="flex-1 min-w-0">
                                                        <div className={`font-bold text-sm truncate ${theme.text}`}>{item.title}</div>
                                                        <div className={`text-[11px] ${theme.textSub} mt-0.5 font-mono`}>
                                                            {formatAgendaTime(item.dateTime ?? '')}
                                                            {char && <span className="ml-2">· {char.name}</span>}
                                                        </div>
                                                    </div>
                                                </button>
                                                <div className="flex items-center shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                                                    <button
                                                        type="button"
                                                        onClick={() => openEditAgendaModal(item)}
                                                        className={`p-1.5 text-sm text-slate-400 ${currentThemeMode === 'cyber' ? 'hover:text-cyan-400' : currentThemeMode === 'soft' ? 'hover:text-pink-500' : 'hover:text-indigo-500'}`}
                                                        title="编辑"
                                                    >
                                                        ✎
                                                    </button>
                                                    <button type="button" onClick={() => handleDeleteAgenda(item.id)} className="text-slate-400 hover:text-red-400 p-1.5 text-sm" title="删除">
                                                        ×
                                                    </button>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}

                            {/* Show all future agenda (if more than 3 and not filtered) */}
                            {!selectedCalDate && agendaItems.filter(a => (a.dateTime?.slice(0, 10) ?? '') >= new Date().toISOString().slice(0, 10)).length > 3 && (
                                <button
                                    onClick={() => {
                                        const today = `${todayDate.getFullYear()}-${String(todayDate.getMonth() + 1).padStart(2, '0')}-${String(todayDate.getDate()).padStart(2, '0')}`;
                                        setSelectedCalDate(today);
                                    }}
                                    className={`mt-3 w-full text-center text-[11px] py-2 rounded-xl transition-all ${theme.textSub} ${currentThemeMode === 'minimal' ? 'shadow-[3px_3px_6px_#d1d9e6,-3px_-3px_6px_#ffffff]' : 'hover:bg-white/10'}`}
                                >
                                    在日历中选择日期查看全部 →
                                </button>
                            )}
                        </div>
                    </div>
                )}

            </div>

            {/* ── Task Modal ── */}
            <Modal isOpen={showTaskModal} title={currentThemeMode === 'cyber' ? 'INITIALIZE QUEST' : '新建任务'} onClose={() => setShowTaskModal(false)} footer={<button onClick={handleAddTask} className={`w-full py-3 font-bold transition-all ${theme.buttonPrimary}`}>确认添加</button>}>
                <div className={`space-y-6 ${currentThemeMode === 'minimal' ? 'p-2' : ''}`}>
                    <input autoFocus value={newTaskTitle} onChange={e => setNewTaskTitle(e.target.value)} placeholder="任务目标 (例如: 背单词)" className={`w-full px-4 py-3 text-sm focus:outline-none ${theme.input}`} />
                    <div>
                        <label className="text-[10px] font-bold text-slate-400 uppercase mb-2 block tracking-widest">选择监督人</label>
                        {/* 分组筛选（没建分组时不渲染）。Modal 恒为白底，走浅色配色 */}
                        <CharacterGroupFilterBar characters={characters} groups={characterGroups}
                            value={supervisorGroupId} onChange={setSupervisorGroupId} className="mb-2" />
                        <div className="flex gap-3 overflow-x-auto no-scrollbar pb-2">
                            {filterCharactersByGroup(characters, characterGroups, supervisorGroupId).map(c => (
                                <button key={c.id} onClick={() => setNewTaskSupervisor(c.id)} className={`flex flex-col items-center gap-2 p-2 rounded-lg border transition-all min-w-[60px] ${newTaskSupervisor === c.id ? `${currentThemeMode === 'minimal' ? 'shadow-[inset_2px_2px_5px_#d1d9e6,inset_-2px_-2px_5px_#ffffff]' : 'border-current'}` : 'border-transparent opacity-50'}`}>
                                    <TokenImg value={c.avatar} className="w-10 h-10 rounded-md object-cover" />
                                    <span className={`text-[10px] font-bold whitespace-nowrap ${theme.text}`}>{c.name}</span>
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            </Modal>

            {/* ── Anniversary Modal ── */}
            <Modal
                isOpen={showAnniModal}
                title={
                    editingAnniId
                        ? (currentThemeMode === 'cyber' ? 'EDIT EVENT' : '编辑纪念日')
                        : (currentThemeMode === 'cyber' ? 'REGISTER EVENT' : '添加纪念日')
                }
                onClose={() => { setShowAnniModal(false); resetAnniForm(); }}
                footer={
                    <button onClick={handleSaveAnni} className={`w-full py-3 font-bold transition-all ${theme.buttonPrimary}`}>
                        {editingAnniId ? (currentThemeMode === 'cyber' ? 'COMMIT' : '保存修改') : '保存记录'}
                    </button>
                }
            >
                <div className={`space-y-4 ${currentThemeMode === 'minimal' ? 'p-2' : ''}`}>
                    <input value={newAnniTitle} onChange={e => setNewAnniTitle(e.target.value)} placeholder="事件名称 (例如: 第一次见面)" className={`w-full px-4 py-3 text-sm focus:outline-none ${theme.input}`} />
                    <input type="date" value={newAnniDate} onChange={e => setNewAnniDate(e.target.value)} className={`w-full px-4 py-3 text-sm focus:outline-none ${theme.input}`} />
                    <div>
                        <label className="text-[10px] font-bold text-slate-400 uppercase mb-2 block tracking-widest">关联对象</label>
                        {/* 分组筛选（没建分组时不渲染）。Modal 恒为白底，走浅色配色 */}
                        <CharacterGroupFilterBar characters={characters} groups={characterGroups}
                            value={anniCharGroupId} onChange={setAnniCharGroupId} className="mb-2" />
                        <div className="flex gap-3 overflow-x-auto no-scrollbar pb-2">
                            {filterCharactersByGroup(characters, characterGroups, anniCharGroupId).map(c => (
                                <button key={c.id} onClick={() => setNewAnniChar(c.id)} className={`flex flex-col items-center gap-2 p-2 rounded-lg border transition-all min-w-[60px] ${newAnniChar === c.id ? `${currentThemeMode === 'minimal' ? 'shadow-[inset_2px_2px_5px_#d1d9e6,inset_-2px_-2px_5px_#ffffff]' : 'border-current'}` : 'border-transparent opacity-50'}`}>
                                    <TokenImg value={c.avatar} className="w-10 h-10 rounded-md object-cover" />
                                    <span className={`text-[10px] font-bold whitespace-nowrap ${theme.text}`}>{c.name}</span>
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Char awareness toggle */}
                    <button
                        onClick={() => setNewAnniCharAware(v => !v)}
                        className={`w-full flex items-center justify-between px-4 py-3 rounded-xl transition-all ${currentThemeMode === 'minimal' ? 'shadow-[4px_4px_8px_#d1d9e6,-4px_-4px_8px_#ffffff]' : currentThemeMode === 'cyber' ? 'bg-slate-800/60 border border-slate-700' : 'bg-white/60 border border-pink-100'}`}
                    >
                        <div className="text-left">
                            <div className={`text-xs font-bold ${theme.text}`}>让 char 记住这一天</div>
                            <div className={`text-[10px] mt-0.5 ${theme.textSub}`}>
                                {newAnniCharAware ? '每年这天 char 会在聊天中自然提到' : '仅作个人记录，char 不会感知'}
                            </div>
                        </div>
                        {/* Toggle pill */}
                        <div className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${newAnniCharAware ? (currentThemeMode === 'cyber' ? 'bg-cyan-600' : currentThemeMode === 'soft' ? 'bg-pink-400' : 'bg-indigo-400') : (currentThemeMode === 'cyber' ? 'bg-slate-700' : 'bg-slate-200')}`}>
                            <div className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-all ${newAnniCharAware ? 'left-6' : 'left-1'}`} />
                        </div>
                    </button>

                    <button
                        onClick={() => setNewAnniRepeatYearly(v => !v)}
                        className={`w-full flex items-center justify-between px-4 py-3 rounded-xl transition-all ${currentThemeMode === 'minimal' ? 'shadow-[4px_4px_8px_#d1d9e6,-4px_-4px_8px_#ffffff]' : currentThemeMode === 'cyber' ? 'bg-slate-800/60 border border-slate-700' : 'bg-white/60 border border-pink-100'}`}
                    >
                        <div className="text-left">
                            <div className={`text-xs font-bold ${theme.text}`}>每年重复提醒</div>
                            <div className={`text-[10px] mt-0.5 ${theme.textSub}`}>
                                {newAnniRepeatYearly ? '以后每年这天都会出现在「即将到来」' : '仅一次：过后不再出现在即将到来（仍保留记录）'}
                            </div>
                        </div>
                        <div className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${newAnniRepeatYearly ? (currentThemeMode === 'cyber' ? 'bg-cyan-600' : currentThemeMode === 'soft' ? 'bg-pink-400' : 'bg-indigo-400') : (currentThemeMode === 'cyber' ? 'bg-slate-700' : 'bg-slate-200')}`}>
                            <div className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-all ${newAnniRepeatYearly ? 'left-6' : 'left-1'}`} />
                        </div>
                    </button>
                </div>
            </Modal>

            {/* ── Agenda Modal ── */}
            <Modal
                isOpen={showAgendaModal}
                title={
                    editingAgendaId
                        ? (currentThemeMode === 'cyber' ? 'EDIT DISPATCH' : currentThemeMode === 'soft' ? '编辑约定 🗓' : 'Edit Agenda')
                        : (currentThemeMode === 'cyber' ? 'NEW DISPATCH' : currentThemeMode === 'soft' ? '新建约定 🗓' : 'New Agenda')
                }
                onClose={() => { setShowAgendaModal(false); resetAgendaForm(); }}
                footer={
                    <button onClick={handleSaveAgenda} className={`w-full py-3 font-bold transition-all ${theme.buttonPrimary}`}>
                        {editingAgendaId ? (currentThemeMode === 'cyber' ? 'COMMIT' : '保存修改') : '保存约定'}
                    </button>
                }
            >
                <div className={`space-y-4 ${currentThemeMode === 'minimal' ? 'p-2' : ''}`}>
                    <input
                        autoFocus
                        value={newAgendaTitle}
                        onChange={e => setNewAgendaTitle(e.target.value)}
                        placeholder={currentThemeMode === 'cyber' ? 'DISPATCH TITLE' : '约定内容 (例如: 和 Char 见面)'}
                        className={`w-full px-4 py-3 text-sm focus:outline-none ${theme.input}`}
                    />
                    <div>
                        <label className="text-[10px] font-bold text-slate-400 uppercase mb-1.5 block tracking-widest">日期与时间</label>
                        <input
                            type="datetime-local"
                            value={newAgendaDateTime}
                            onChange={e => setNewAgendaDateTime(e.target.value)}
                            className={`w-full px-4 py-3 text-sm focus:outline-none ${theme.input}`}
                        />
                    </div>
                    {/* Reminder time selector */}
                    <div>
                        <label className="text-[10px] font-bold text-slate-400 uppercase mb-2 block tracking-widest">提前提醒</label>
                        <div className="grid grid-cols-4 gap-1.5">
                            {REMINDER_OPTIONS.map(opt => {
                                const isActive = newAgendaReminder === opt.value;
                                return (
                                    <button
                                        key={String(opt.value)}
                                        onClick={() => setNewAgendaReminder(opt.value)}
                                        className={`py-2 text-[11px] font-bold rounded-lg transition-all active:scale-95 ${
                                            isActive
                                                ? `${theme.accent} ${currentThemeMode === 'cyber' ? 'bg-cyan-900/60 border border-cyan-700' : currentThemeMode === 'minimal' ? 'shadow-[inset_2px_2px_5px_#d1d9e6,inset_-2px_-2px_5px_#ffffff] bg-[#eef2f6]' : 'bg-white shadow-sm'}`
                                                : `${theme.textSub} ${currentThemeMode === 'cyber' ? 'bg-slate-800/50' : currentThemeMode === 'minimal' ? 'shadow-[2px_2px_5px_#d1d9e6,-2px_-2px_5px_#ffffff]' : 'bg-white/40'}`
                                        }`}
                                    >{opt.label}</button>
                                );
                            })}
                        </div>
                        {newAgendaReminder !== null && (
                            <p className={`mt-1.5 text-[10px] ${theme.textSub}`}>
                                {newAgendaReminder === 0 ? '约定开始时' : `约定前 ${newAgendaReminder} 分钟`}，{newAgendaChar ? (characters.find(c => c.id === newAgendaChar)?.name ?? 'char') : (characters[0]?.name ?? 'char')} 会发消息提醒你
                            </p>
                        )}
                    </div>

                    {/* Char selector */}
                    <div>
                        <label className="text-[10px] font-bold text-slate-400 uppercase mb-2 block tracking-widest">关联角色 (可选)</label>
                        <div className="flex gap-3 overflow-x-auto no-scrollbar pb-2">
                            {/* No-char option */}
                            <button onClick={() => setNewAgendaChar('')} className={`flex flex-col items-center gap-2 p-2 rounded-lg border transition-all min-w-[60px] ${newAgendaChar === '' ? currentThemeMode === 'minimal' ? 'shadow-[inset_2px_2px_5px_#d1d9e6,inset_-2px_-2px_5px_#ffffff]' : 'border-current' : 'border-transparent opacity-50'}`}>
                                <div className={`w-10 h-10 rounded-md flex items-center justify-center text-lg ${currentThemeMode === 'cyber' ? 'bg-slate-800' : 'bg-slate-100'}`}>—</div>
                                <span className={`text-[10px] font-bold whitespace-nowrap ${theme.text}`}>无</span>
                            </button>
                            {characters.map(c => (
                                <button key={c.id} onClick={() => setNewAgendaChar(c.id)} className={`flex flex-col items-center gap-2 p-2 rounded-lg border transition-all min-w-[60px] ${newAgendaChar === c.id ? currentThemeMode === 'minimal' ? 'shadow-[inset_2px_2px_5px_#d1d9e6,inset_-2px_-2px_5px_#ffffff]' : 'border-current' : 'border-transparent opacity-50'}`}>
                                    <img src={c.avatar} className="w-10 h-10 rounded-md object-cover" />
                                    <span className={`text-[10px] font-bold whitespace-nowrap ${theme.text}`}>{c.name}</span>
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            </Modal>

        </div>
    );
};

export default ScheduleApp;
