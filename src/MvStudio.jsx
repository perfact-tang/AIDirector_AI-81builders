import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  Check, Copy, Edit3, Film, LoaderCircle, Music, Play, Plus, RefreshCw, Save,
  Sparkles, Square, Upload, Video, Volume2, Wand2, Zap, MoveRight, Download, Trash2, Layers,
} from 'lucide-react';
import { useI18n } from './LanguageProvider.jsx';
import { useAuth } from './AuthProvider.jsx';
import { VISUAL_STYLES } from './visual-styles.js';
import { MUSIC_GENRES, parseLrc, formatClock } from './mv-lrc.js';
import { DEFAULT_MV_REFERENCES, renderPresetDataUrl } from './mv-presets.js';
import { readImage } from './character-images.js';
import { extractLastFrame } from './video-last-frame.js';
import { fingerprint } from './video-references.js';
import { downloadZip } from './download-zip.js';
import { SpeechReader, SPEECH_LANGUAGES } from './speech.js';
import { Modal } from './GenerationDialog.jsx';
import MediaPlaylist from './MediaPlaylist.jsx';

const STATUS_LABELS = {
  submitting: '正在上传素材并提交',
  moderating: '正在审核提示词与素材',
  translating: '正在准备模型提示词',
  queued: '已排队，等待生成',
  in_progress: '正在生成动画',
  completed: '生成完成',
  failed: '生成失败',
  canceled: '任务已结束',
  submission_unknown: '提交状态待确认，请先检查 ai& 控制台',
};

const ACTIVE_MV_STORAGE_KEY = 'director-mv-active-id';

const isTerminal = (job) =>
  ['failed', 'canceled', 'submission_unknown'].includes(job?.status) ||
  (job?.status === 'completed' && Boolean(job.url));

function waitMs(ms, signal) {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();
  });
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('文件读取失败，请重试。'));
    reader.readAsDataURL(file);
  });
}

async function fetchAsDataUrl(url, signal) {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error('无法读取音频切片文件。');
  const blob = await res.blob();
  return readFileAsDataUrl(blob);
}

async function apiJson(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) location.assign('/');
    throw new Error(data.error || '请求失败。');
  }
  return data;
}

function syncMvUrl(id) {
  try {
    const url = new URL(location.href);
    url.searchParams.set('mode', 'mv');
    if (id) url.searchParams.set('mv', id);
    else url.searchParams.delete('mv');
    history.replaceState({}, '', url.pathname + url.search);
    if (id) localStorage.setItem(ACTIVE_MV_STORAGE_KEY, id);
    else localStorage.removeItem(ACTIVE_MV_STORAGE_KEY);
  } catch {
    // Ignore storage/history restrictions
  }
}

export default function MvStudio() {
  const { t } = useI18n();
  const { enabled: cloudEnabled } = useAuth();

  // Saved MV projects list & active project ID
  const [projectId, setProjectId] = useState(() => {
    const q = new URLSearchParams(location.search).get('mv');
    if (q) return q;
    try { return localStorage.getItem(ACTIVE_MV_STORAGE_KEY) || crypto.randomUUID(); } catch { return crypto.randomUUID(); }
  });
  const [projects, setProjects] = useState([]);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [saveStatus, setSaveStatus] = useState('');
  const [hydrated, setHydrated] = useState(false);

  // Cloud / Local Character Library
  const [characters, setCharacters] = useState([]);
  const [charactersLoading, setCharactersLoading] = useState(false);
  const [selectedCharIds, setSelectedCharIds] = useState([]);
  const [charModal, setCharModal] = useState(null); // null | { id?, name, prompt, image, saving, error }
  const [copiedPrompt, setCopiedPrompt] = useState(false);

  // Form state
  const [audioFile, setAudioFile] = useState(null); // { name, dataUrl?, objectUrl?, url?, duration }
  const [lrcText, setLrcText] = useState('');
  const [lrcFileName, setLrcFileName] = useState('');
  const [visualStyle, setVisualStyle] = useState('cyberpunk');
  const [genre, setGenre] = useState('pop');
  const [pace, setPace] = useState(5);
  const [aspect, setAspect] = useState('16:9');
  const [inspiration, setInspiration] = useState('');

  // Speech synthesis for reading MV scripts aloud
  const [speech, setSpeech] = useState({});
  const [speechLang, setSpeechLang] = useState('zh-CN');
  const reader = useMemo(
    () => new SpeechReader({ synth: window.speechSynthesis, Utterance: window.SpeechSynthesisUtterance, onState: setSpeech }),
    [],
  );
  useEffect(() => {
    reader.stop();
  }, [speechLang, reader]);

  // Cleanup local blob URL on unmount/change
  useEffect(() => {
    return () => {
      if (audioFile?.objectUrl) URL.revokeObjectURL(audioFile.objectUrl);
    };
  }, [audioFile?.objectUrl]);

  // Pipeline state
  const [phase, setPhase] = useState('idle'); // idle | slicing | scripting | ready
  const [statusMsg, setStatusMsg] = useState('');
  const [error, setError] = useState('');
  const [session, setSession] = useState(null);
  const [story, setStory] = useState(null);
  const [shots, setShots] = useState({});
  const [scriptProgress, setScriptProgress] = useState({ completed: 0, total: 0 });

  // MiniMax H3 video generation state
  const [videoConfig, setVideoConfig] = useState(null);
  const [videoConfigError, setVideoConfigError] = useState('');
  const [videoModel, setVideoModel] = useState('');
  const [videoConfirmation, setVideoConfirmation] = useState(null);
  const [jobs, setJobs] = useState({});
  const [queue, setQueue] = useState([]);
  const [videoBusy, setVideoBusy] = useState(false);
  const [videoMessage, setVideoMessage] = useState('');
  const [playlist, setPlaylist] = useState(null);
  const [merging, setMerging] = useState(false);
  const [mergedUrl, setMergedUrl] = useState('');
  const [packing, setPacking] = useState(false);

  const scriptAbortRef = useRef(null);
  const videoAbortRef = useRef(null);
  const jobsRef = useRef(jobs);
  jobsRef.current = jobs;
  const shotsRef = useRef(shots);
  shotsRef.current = shots;
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const saveChainRef = useRef(Promise.resolve());

  // --- Loaders ---
  const refreshProjects = useCallback(async () => {
    setProjectsLoading(true);
    try {
      const data = await apiJson('/api/mv/projects');
      setProjects(data.projects || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setProjectsLoading(false);
    }
  }, []);

  const refreshCharacters = useCallback(async () => {
    setCharactersLoading(true);
    try {
      const data = await apiJson('/api/mv/characters');
      setCharacters(data.characters || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setCharactersLoading(false);
    }
  }, []);

  const applyProjectData = useCallback((data) => {
    scriptAbortRef.current?.abort();
    videoAbortRef.current?.abort();
    reader.stop();
    setProjectId(data.id);
    syncMvUrl(data.id);
    setLrcText(data.lrcText || '');
    setLrcFileName(data.lrcFileName || '');
    setVisualStyle(data.visualStyle || 'cyberpunk');
    setGenre(data.genre || 'pop');
    setPace(data.pace === 10 ? 10 : 5);
    setAspect(data.aspect || '16:9');
    setInspiration(data.inspiration || '');
    setSelectedCharIds(Array.isArray(data.selectedCharacterIds) ? data.selectedCharacterIds : []);
    setSession(data.session || null);
    sessionRef.current = data.session || null;
    setStory(data.story || null);
    setShots(data.shots || {});
    shotsRef.current = data.shots || {};
    setJobs(data.jobs || {});
    jobsRef.current = data.jobs || {};
    setMergedUrl(data.mergedUrl || '');
    setVideoConfirmation(null);
    setQueue([]);
    setVideoBusy(false);
    setError('');
    setVideoMessage('');
    if (data.session?.masterAudioUrl || data.audioName) {
      setAudioFile({
        name: data.audioName || `${data.title || 'song'}.mp3`,
        url: data.session?.masterAudioUrl || '',
        duration: data.audioDuration || data.session?.durationSeconds || 0,
      });
    } else {
      setAudioFile(null);
    }
    const sliceCount = data.session?.slices?.length || 0;
    const shotCount = Object.keys(data.shots || {}).length;
    setScriptProgress({ completed: shotCount, total: sliceCount });
    setPhase(sliceCount ? 'ready' : 'idle');
    setStatusMsg(shotCount ? `已恢复 MV 项目（共 ${shotCount} 条分镜）。` : '');
    setSaveStatus('已恢复保存的 MV 项目');
  }, [reader]);

  const openProject = useCallback(async (id) => {
    setError('');
    try {
      const data = await apiJson(`/api/mv/projects/${encodeURIComponent(id)}`);
      applyProjectData(data);
    } catch (e) {
      setError(e.message);
    }
  }, [applyProjectData]);

  function startNewProject() {
    scriptAbortRef.current?.abort();
    videoAbortRef.current?.abort();
    reader.stop();
    const nextId = crypto.randomUUID();
    setProjectId(nextId);
    syncMvUrl(nextId);
    setAudioFile(null);
    setLrcText('');
    setLrcFileName('');
    setInspiration('');
    setSession(null);
    sessionRef.current = null;
    setStory(null);
    setShots({});
    shotsRef.current = {};
    setJobs({});
    jobsRef.current = {};
    setVideoConfirmation(null);
    setQueue([]);
    setVideoBusy(false);
    setMergedUrl('');
    setPhase('idle');
    setStatusMsg('');
    setVideoMessage('');
    setError('');
    setSaveStatus('');
    setScriptProgress({ completed: 0, total: 0 });
  }

  async function deleteProject(id, e) {
    e.stopPropagation();
    try {
      await apiJson(`/api/mv/projects/${encodeURIComponent(id)}`, { method: 'DELETE' });
      setProjects((prev) => prev.filter((p) => p.id !== id));
      if (id === projectId) startNewProject();
    } catch (err) {
      setError(err.message);
    }
  }

  // Initial mount: load video config, saved MV projects, saved characters, and restore active MV project
  async function loadVideoConfig() {
    setVideoConfig(null);
    setVideoConfigError('');
    try {
      setVideoConfig(await apiJson('/api/videos/config?choices=1'));
    } catch (err) {
      setVideoConfigError(err.message);
    }
  }

  useEffect(() => {
    let active = true;
    loadVideoConfig();
    Promise.all([refreshProjects(), refreshCharacters()]).then(async () => {
      if (!active) return;
      const targetId = new URLSearchParams(location.search).get('mv') || (() => {
        try { return localStorage.getItem(ACTIVE_MV_STORAGE_KEY); } catch { return null; }
      })();
      if (targetId) {
        try {
          const saved = await apiJson(`/api/mv/projects/${encodeURIComponent(targetId)}`);
          if (active && saved?.id) applyProjectData(saved);
        } catch {
          // Not saved yet; keep fresh project ID
        }
      }
      if (active) setHydrated(true);
    });
    return () => {
      active = false;
      scriptAbortRef.current?.abort();
      videoAbortRef.current?.abort();
      reader.stop();
    };
  }, [reader, refreshProjects, refreshCharacters, applyProjectData]);

  // Recover any in-progress H3 video jobs after page reload
  useEffect(() => {
    if (!hydrated || !session) return;
    const controller = new AbortController();
    let timer;
    async function pollPending() {
      let hasActive = false;
      for (const [idx, job] of Object.entries(jobsRef.current)) {
        if (controller.signal.aborted) break;
        if (!job?.id || isTerminal(job) || queue.includes(Number(idx))) continue;
        hasActive = true;
        try {
          const res = await fetch(`/api/videos/${encodeURIComponent(job.id)}`, { signal: controller.signal });
          if (!res.ok) continue;
          const remote = await res.json();
          setJobs((prev) => (prev[idx]?.id === job.id ? { ...prev, [idx]: { ...prev[idx], ...remote } } : prev));
        } catch (err) {
          if (err.name === 'AbortError') break;
        }
      }
      if (hasActive && !controller.signal.aborted) {
        timer = setTimeout(pollPending, 15000);
      }
    }
    pollPending();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [hydrated, session?.sessionId, queue]);

  // Save current MV project
  const persistCurrentProject = useCallback(async (quiet = true) => {
    const hasContent = Boolean(session || story || Object.keys(shots).length || lrcText.trim() || inspiration.trim());
    if (!hasContent) return;
    if (!quiet) setSaveStatus('正在保存 MV 项目…');
    const payload = {
      audioName: audioFile?.name || '',
      audioDuration: audioFile?.duration || session?.durationSeconds || 0,
      lrcText,
      lrcFileName,
      visualStyle,
      genre,
      pace,
      aspect,
      inspiration,
      selectedCharacterIds: selectedCharIds,
      session,
      story,
      shots,
      jobs,
      mergedUrl,
    };
    const task = saveChainRef.current
      .catch(() => {})
      .then(async () => {
        const res = await apiJson(`/api/mv/projects/${encodeURIComponent(projectId)}`, {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        syncMvUrl(projectId);
        if (res.summary) {
          setProjects((prev) => [res.summary, ...prev.filter((p) => p.id !== res.summary.id)]);
        }
        setSaveStatus(cloudEnabled ? 'MV 项目已自动保存到云端' : 'MV 项目已自动保存');
      })
      .catch((err) => {
        setSaveStatus(`保存失败：${err.message}`);
      });
    saveChainRef.current = task;
    return task;
  }, [
    projectId, audioFile?.name, audioFile?.duration, lrcText, lrcFileName,
    visualStyle, genre, pace, aspect, inspiration, selectedCharIds,
    session, story, shots, jobs, mergedUrl, cloudEnabled,
  ]);

  // Auto-save whenever state updates after hydration
  useEffect(() => {
    if (!hydrated || phase === 'slicing') return;
    const hasContent = Boolean(session || story || Object.keys(shots).length || lrcText.trim() || inspiration.trim());
    if (!hasContent) return;
    const timer = setTimeout(() => {
      persistCurrentProject(true);
    }, 1200);
    return () => clearTimeout(timer);
  }, [hydrated, phase, persistCurrentProject, session, story, shots, lrcText, inspiration]);

  // --- Character Library Actions ---
  function toggleCharacterSelect(id) {
    setSelectedCharIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id].slice(-4),
    );
  }

  function openAddCharacter() {
    setCopiedPrompt(false);
    setCharModal({ id: '', name: '', prompt: '', image: '', saving: false, error: '' });
  }

  function openEditCharacter(character, e) {
    e.stopPropagation();
    setCopiedPrompt(false);
    setCharModal({
      id: character.id,
      name: character.name,
      prompt: character.prompt || '',
      image: character.image || '',
      saving: false,
      error: '',
    });
  }

  async function handleModalImageUpload(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const image = await readImage(file);
      setCharModal((m) => (m ? { ...m, image, error: '' } : m));
    } catch (err) {
      setCharModal((m) => (m ? { ...m, error: err.message } : m));
    }
  }

  async function saveCharacterModal(e) {
    e.preventDefault();
    if (!charModal) return;
    if (!charModal.name.trim()) {
      setCharModal((m) => ({ ...m, error: '请输入人物名称。' }));
      return;
    }
    if (!charModal.image) {
      setCharModal((m) => ({ ...m, error: '请先上传人物参考图。' }));
      return;
    }
    setCharModal((m) => ({ ...m, saving: true, error: '' }));
    try {
      const res = await apiJson('/api/mv/characters', {
        method: 'POST',
        body: JSON.stringify({
          id: charModal.id || undefined,
          name: charModal.name.trim(),
          prompt: charModal.prompt.trim(),
          image: charModal.image,
        }),
      });
      const saved = res.character;
      setCharacters((prev) => [saved, ...prev.filter((c) => c.id !== saved.id)]);
      if (!charModal.id) {
        setSelectedCharIds((prev) => (prev.includes(saved.id) ? prev : [...prev, saved.id].slice(-4)));
      }
      setCharModal(null);
    } catch (err) {
      setCharModal((m) => (m ? { ...m, saving: false, error: err.message } : m));
    }
  }

  async function deleteCharacterModal() {
    if (!charModal?.id) return;
    setCharModal((m) => ({ ...m, saving: true, error: '' }));
    try {
      await apiJson(`/api/mv/characters/${encodeURIComponent(charModal.id)}`, { method: 'DELETE' });
      setCharacters((prev) => prev.filter((c) => c.id !== charModal.id));
      setSelectedCharIds((prev) => prev.filter((id) => id !== charModal.id));
      setCharModal(null);
    } catch (err) {
      setCharModal((m) => (m ? { ...m, saving: false, error: err.message } : m));
    }
  }

  async function copyModalPrompt() {
    if (!charModal?.prompt?.trim()) return;
    try {
      await navigator.clipboard.writeText(charModal.prompt);
      setCopiedPrompt(true);
      setTimeout(() => setCopiedPrompt(false), 2000);
    } catch {
      setCharModal((m) => (m ? { ...m, error: '无法复制到剪贴板，请手动选中复制。' } : m));
    }
  }

  async function seedStarterCharacters() {
    setCharactersLoading(true);
    setError('');
    try {
      const starters = DEFAULT_MV_REFERENCES.slice(0, 3);
      const created = [];
      for (const preset of starters) {
        const image = renderPresetDataUrl(preset);
        const res = await apiJson('/api/mv/characters', {
          method: 'POST',
          body: JSON.stringify({
            name: preset.name,
            role: preset.role,
            prompt: preset.prompt,
            image,
          }),
        });
        created.push(res.character);
      }
      setCharacters((prev) => [...created, ...prev]);
      if (!selectedCharIds.length && created[0]) {
        setSelectedCharIds([created[0].id]);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setCharactersLoading(false);
    }
  }

  const parsedLrc = useMemo(() => parseLrc(lrcText), [lrcText]);
  const estimatedSlices = audioFile?.duration ? Math.max(1, Math.ceil(audioFile.duration / pace)) : 0;

  // Active references sent to script & MiniMax H3
  const activeReferences = useMemo(() => {
    const selected = characters.filter((c) => selectedCharIds.includes(c.id) && c.image);
    if (selected.length) {
      return selected.slice(0, 4).map((c) => ({
        character_id: c.id,
        name: c.name,
        role: c.role || 'MV 主角',
        prompt: c.prompt || '',
        image: c.image,
      }));
    }
    // Safe fallback if user did not select any character
    const fallback = DEFAULT_MV_REFERENCES.find((p) => p.recommendedStyles.includes(visualStyle)) || DEFAULT_MV_REFERENCES[0];
    const fallbackImage = renderPresetDataUrl(fallback);
    return fallbackImage
      ? [{ character_id: `CHAR-PRESET-${fallback.id.toUpperCase()}`, name: fallback.name, role: fallback.role, prompt: fallback.prompt, image: fallbackImage }]
      : [];
  }, [characters, selectedCharIds, visualStyle]);

  async function handleAudioUpload(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError('');
    if (file.size > 35 * 1024 * 1024) {
      setError('音频文件超过 35 MB 限制，请压缩后上传。');
      return;
    }
    try {
      const dataUrl = await readFileAsDataUrl(file);
      const objectUrl = URL.createObjectURL(file);
      const duration = await new Promise((resolve) => {
        const audio = document.createElement('audio');
        audio.preload = 'metadata';
        audio.onloadedmetadata = () => resolve(Number.isFinite(audio.duration) ? audio.duration : 0);
        audio.onerror = () => resolve(0);
        audio.src = objectUrl;
      });
      if (audioFile?.objectUrl) URL.revokeObjectURL(audioFile.objectUrl);
      setAudioFile({ name: file.name, dataUrl, objectUrl, duration });
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleLrcUpload(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError('');
    try {
      const text = await file.text();
      setLrcText(text);
      setLrcFileName(file.name);
    } catch {
      setError('无法读取 LRC 歌词文件。');
    }
  }

  function updateShot(index, patch) {
    setShots((prev) => ({
      ...prev,
      [index]: { ...(prev[index] || {}), ...patch },
    }));
  }

  function stopVideoGeneration() {
    videoAbortRef.current?.abort();
    setQueue([]);
    setVideoBusy(false);
    setVideoMessage('已停止后续生成。已提交的动画仍会继续处理，结果将自动保留。');
  }

  function formatVideoCost(amount, currency) {
    const unit = currency.toLowerCase() === 'jpy' ? t('日元') : currency.toUpperCase();
    return `${Number(Number(amount).toFixed(6))} ${unit}`;
  }

  function requestVideoGeneration(indices) {
    if (!canGenerateVideo || videoBusy || !indices.length) return;
    const seconds = indices.reduce((total, index) => total + slices[index].duration, 0);
    const generation = { indices, seconds, model: selectedVideoModel, sessionId: sessionRef.current?.sessionId };
    if (generation.model.requiresConfirmation) {
      setVideoConfirmation(generation);
      return;
    }
    startVideoQueue(generation);
  }

  async function startVideoQueue(generation) {
    const { indices, model, sessionId } = generation;
    const activeSession = sessionRef.current;
    const activeShots = shotsRef.current;
    if (!activeSession?.slices?.length || activeSession.sessionId !== sessionId || videoBusy) return;

    videoAbortRef.current?.abort();
    const controller = new AbortController();
    videoAbortRef.current = controller;
    setQueue(indices);
    setVideoBusy(true);
    setMergedUrl('');
    setVideoMessage(`已加入 ${indices.length} 个 MV 切片，依次生成 MiniMax H3 视频…`);

    try {
      for (let pos = 0; pos < indices.length; pos++) {
        if (controller.signal.aborted) break;
        const idx = indices[pos];
        const slice = activeSession.slices[idx];
        const shot = activeShots[idx];
        if (!slice || !shot) continue;

        const requestId = crypto.randomUUID();
        setJobs((prev) => ({
          ...prev,
          [idx]: { id: requestId, status: 'submitting', shotId: slice.shotId },
        }));
        setVideoMessage(`正在处理 ${slice.shotId}（${pos + 1}/${indices.length}）…`);

        try {
          const audioDataUrl = await fetchAsDataUrl(slice.audioUrl, controller.signal);
          let continuityImage;
          let continuityMeta;

          if (shot.use_previous_frame && idx > 0) {
            const prevJob = jobsRef.current[idx - 1];
            if (prevJob?.status === 'completed' && prevJob.url) {
              setVideoMessage(`正在为 ${slice.shotId} 提取上一镜头尾帧…`);
              const frame = await extractLastFrame(prevJob.url, { signal: controller.signal });
              continuityImage = frame.image;
              continuityMeta = {
                sourceUrl: prevJob.url,
                sourceKey: fingerprint(prevJob.id + prevJob.url),
                sourceIndex: idx - 1,
                frameTime: frame.frameTime,
                sourceDuration: frame.sourceDuration,
                width: frame.width,
                height: frame.height,
              };
            }
          }

          const refs = activeReferences.map((r) => ({
            character_id: r.character_id,
            name: r.name,
            image: r.image,
          }));
          const characterRefs = refs.map((r) => r.character_id);
          const referenceKey = fingerprint(
            JSON.stringify(['mv-h3', slice.shotId, shot.video_prompt, shot.image_prompt, characterRefs, Boolean(continuityImage)]),
          );

          const body = {
            requestId,
            model: model.id,
            ...(model.requiresConfirmation ? { confirmedRate: model.rate } : {}),
            shotId: slice.shotId,
            revision: 'mv-auto',
            audioMode: 'music',
            prompt: shot.video_prompt,
            firstPrompt: shot.image_prompt,
            seconds: slice.duration,
            aspect,
            characters: refs,
            characterRefs,
            image: continuityImage,
            continuity: continuityMeta,
            audio: audioDataUrl,
            referenceKey,
          };

          const submitRes = await fetch('/api/videos', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: controller.signal,
          });
          let job = await submitRes.json();
          if (!submitRes.ok) {
            job = { id: requestId, status: 'failed', error: job.error || '视频提交失败。' };
          }

          while (!controller.signal.aborted) {
            setJobs((prev) => ({ ...prev, [idx]: job }));
            if (isTerminal(job)) break;
            await waitMs(15000, controller.signal);
            const pollRes = await fetch(`/api/videos/${encodeURIComponent(requestId)}`, {
              signal: controller.signal,
            });
            job = await pollRes.json();
            if (!pollRes.ok) throw new Error(job.error || '无法查询视频任务状态。');
          }

          if (!controller.signal.aborted) {
            setJobs((prev) => ({ ...prev, [idx]: job }));
            setQueue((prev) => prev.filter((item) => item !== idx));
            if (job.errorCode === 'video_quote_changed') {
              setVideoMessage(job.error);
              void loadVideoConfig();
              return;
            }
          }
        } catch (shotErr) {
          if (controller.signal.aborted || shotErr.name === 'AbortError') break;
          setJobs((prev) => ({
            ...prev,
            [idx]: { id: requestId, status: 'failed', error: shotErr.message || '生成失败' },
          }));
          setQueue((prev) => prev.filter((item) => item !== idx));
        }
      }

      if (!controller.signal.aborted) {
        setVideoMessage('MiniMax H3 批量生成流程已结束。可预览片段、重试失败项或一键合成完整 MV。');
      }
    } finally {
      if (videoAbortRef.current === controller) {
        setVideoBusy(false);
        setQueue([]);
      }
    }
  }

  async function handleStartMv(e) {
    e.preventDefault();
    const canReuseExistingAudio = Boolean(session?.masterAudioUrl && !audioFile?.dataUrl);
    if (!audioFile?.dataUrl && !canReuseExistingAudio) {
      setError('请先上传 MP3 或 WAV 歌曲文件。');
      return;
    }

    scriptAbortRef.current?.abort();
    videoAbortRef.current?.abort();
    const controller = new AbortController();
    scriptAbortRef.current = controller;

    setError('');
    setStory(null);
    setShots({});
    setJobs({});
    setQueue([]);
    setVideoBusy(false);
    setMergedUrl('');
    setVideoMessage('');
    setPhase('slicing');
    setStatusMsg(`正在按每 ${pace} 秒自动切片音频并对齐 LRC 歌词…`);

    try {
      let audioDataUrl = audioFile?.dataUrl;
      if (!audioDataUrl && session?.masterAudioUrl) {
        audioDataUrl = await fetchAsDataUrl(session.masterAudioUrl, controller.signal);
      }

      const sliceRes = await fetch('/api/mv/slice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          audioDataUrl,
          filename: audioFile?.name || 'song.mp3',
          pace,
          lrcText,
        }),
        signal: controller.signal,
      });
      const sliceData = await sliceRes.json();
      if (!sliceRes.ok) throw new Error(sliceData.error || '音频切片失败。');

      setSession(sliceData);
      sessionRef.current = sliceData;
      setScriptProgress({ completed: 0, total: sliceData.slices.length });
      setPhase('scripting');
      setStatusMsg(`已完成 ${sliceData.slices.length} 段音频切片，正在构思故事并逐条输出 MV 脚本…`);

      const streamRes = await fetch('/api/mv/script-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: sliceData.meta?.title || (audioFile?.name || 'song').replace(/\.[^.]+$/, ''),
          artist: sliceData.meta?.artist || '',
          genre,
          visualStyle,
          pace,
          inspiration,
          characters: activeReferences.map((r) => ({ name: r.name, role: r.role, prompt: r.prompt })),
          slices: sliceData.slices,
        }),
        signal: controller.signal,
      });

      if (!streamRes.ok) {
        const errData = await streamRes.json().catch(() => ({}));
        throw new Error(errData.error || '无法启动 MV 脚本生成。');
      }

      const readerStream = streamRes.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      const collectedShots = {};

      while (true) {
        const { done, value } = await readerStream.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split('\n\n');
        buffer = events.pop() || '';

        for (const rawEvent of events) {
          let eventName = 'message';
          let dataLine = '';
          for (const line of rawEvent.split('\n')) {
            if (line.startsWith('event:')) eventName = line.slice(6).trim();
            else if (line.startsWith('data:')) dataLine += line.slice(5).trim();
          }
          if (!dataLine) continue;
          const payload = JSON.parse(dataLine);

          if (eventName === 'story') {
            setStory(payload);
          } else if (eventName === 'shot') {
            collectedShots[payload.index] = payload;
            setShots((prev) => ({ ...prev, [payload.index]: payload }));
          } else if (eventName === 'progress') {
            setStatusMsg(payload.stage || '');
            setScriptProgress({ completed: payload.completed || 0, total: payload.total || sliceData.slices.length });
          } else if (eventName === 'error') {
            throw new Error(payload.error || 'MV 脚本生成中断。');
          }
        }
      }

      shotsRef.current = collectedShots;
      setPhase('ready');
      setStatusMsg(`分镜动态提示词已全部生成（共 ${Object.keys(collectedShots).length} 条镜头）。请先审阅或朗读检查，确认无误后点击「生成全部」。`);
    } catch (err) {
      if (err.name === 'AbortError') return;
      setError(err.message || 'MV 生成流程失败。');
      setPhase(sessionRef.current ? 'ready' : 'idle');
    }
  }

  const slices = session?.slices || [];
  const completedVideoEntries = slices
    .map((s) => ({ slice: s, job: jobs[s.index] }))
    .filter(({ job }) => job?.status === 'completed' && Boolean(job.url));
  const pendingIndices = slices
    .map((s) => s.index)
    .filter((i) => shots[i] && !(jobs[i]?.status === 'completed' && jobs[i]?.url));
  const allScriptedIndices = slices.map((s) => s.index).filter((i) => Boolean(shots[i]));
  const batchVideoIndices = pendingIndices.length ? pendingIndices : allScriptedIndices;
  const batchVideoSeconds = batchVideoIndices.reduce((total, index) => total + slices[index].duration, 0);
  const speechItems = slices
    .filter((s) => shots[s.index]?.video_prompt?.trim())
    .map((s) => ({
      key: `mv-shot-${s.index}`,
      label: `${s.shotId} · ${shots[s.index].section || s.section}`,
      text: shots[s.index].video_prompt.trim(),
    }));
  const selectedVideoModel = videoConfig?.choices?.find((choice) => choice.id === (videoModel || videoConfig.defaultModel));
  const price = selectedVideoModel?.rate;
  const canGenerateVideo = Boolean(videoConfig?.accepted && price);
  const videoServiceMessage = videoConfigError || (videoConfig && !videoConfig.accepted
    ? '请先在 ai& 控制台 Playground 接受视频服务条款。'
    : selectedVideoModel?.error);

  async function handleMergeMv() {
    if (!session?.sessionId || !completedVideoEntries.length) return;
    setMerging(true);
    setError('');
    try {
      const res = await fetch('/api/mv/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: session.sessionId,
          videoIds: completedVideoEntries.map(({ job }) => job.id),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '合成完整 MV 失败。');
      setMergedUrl(`${data.url}?t=${Date.now()}`);
      setVideoMessage('完整 MV 已合成并锁定原曲音轨！');
    } catch (err) {
      setError(err.message);
    } finally {
      setMerging(false);
    }
  }

  async function handleZipVideos() {
    if (!completedVideoEntries.length) return;
    setPacking(true);
    try {
      await downloadZip(
        completedVideoEntries.map(({ slice, job }) => ({
          name: `${slice.shotId}.mp4`,
          url: job.url,
        })),
        `${(story?.title || session?.meta?.title || 'music-mv').replace(/[^\w\u4e00-\u9fa5-]+/g, '_')}.zip`,
        setVideoMessage,
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setPacking(false);
    }
  }

  function openPlaylist() {
    if (!completedVideoEntries.length) return;
    setPlaylist(
      completedVideoEntries.map(({ slice, job }) => ({
        label: `${slice.shotId} · ${slice.timestamp}`,
        text: slice.lyrics,
        url: job.url,
      })),
    );
  }

  const busyInput = phase === 'slicing' || phase === 'scripting';
  const audioPreviewSrc = audioFile?.objectUrl || audioFile?.url || session?.masterAudioUrl || '';

  return (
    <div className="mv-studio">
      {playlist && <MediaPlaylist items={playlist} type="video" onClose={() => setPlaylist(null)} />}
      {videoConfirmation && (
        <Modal
          title={t('确认使用高价模型？')}
          onCancel={() => setVideoConfirmation(null)}
          footer={<>
            <button type="button" className="small-button" autoFocus onClick={() => setVideoConfirmation(null)}>{t('取消')}</button>
            <button type="button" className="small-button save-image" onClick={() => {
              setVideoConfirmation(null);
              startVideoQueue(videoConfirmation);
            }}>{t('确认并生成')}</button>
          </>}
        >
          <p className="generation-summary">
            {t(`${videoConfirmation.model.label} 是高价档，单价 ${formatVideoCost(videoConfirmation.model.rate.per_second, videoConfirmation.model.rate.currency)} / 秒。`)}
          </p>
          <p className="generation-note">
            {t(`本次生成 ${videoConfirmation.indices.length} 段，共 ${videoConfirmation.seconds} 秒，预计 ${formatVideoCost(videoConfirmation.seconds * Number(videoConfirmation.model.rate.per_second), videoConfirmation.model.rate.currency)}。`)}
          </p>
        </Modal>
      )}

      {/* Add / Edit Character Modal */}
      {charModal && (
        <Modal
          title={t(charModal.id ? '编辑参考人物' : '添加参考人物')}
          onCancel={() => !charModal.saving && setCharModal(null)}
          footer={
            <div className="mv-modal-footer-row">
              {charModal.id && (
                <button
                  type="button"
                  className="small-button mv-danger-btn"
                  disabled={charModal.saving}
                  onClick={deleteCharacterModal}
                >
                  <Trash2 size={13} /> {t('删除人物')}
                </button>
              )}
              <div className="speech-actions">
                <button
                  type="button"
                  className="small-button"
                  disabled={charModal.saving}
                  onClick={() => setCharModal(null)}
                >
                  {t('取消')}
                </button>
                <button
                  type="submit"
                  form="mv-char-form"
                  className="small-button save-image"
                  disabled={charModal.saving}
                >
                  {charModal.saving ? <LoaderCircle className="spin" size={13} /> : <Save size={13} />}
                  {' '}
                  {t(charModal.saving ? '正在保存…' : '保存人物')}
                </button>
              </div>
            </div>
          }
        >
          <form id="mv-char-form" className="mv-char-form" onSubmit={saveCharacterModal}>
            <label className="voice-label" htmlFor="mv-char-name">{t('人物名称')}</label>
            <input
              id="mv-char-name"
              className="shot-search"
              type="text"
              maxLength={60}
              value={charModal.name}
              onChange={(e) => setCharModal((m) => ({ ...m, name: e.target.value }))}
              placeholder={t('例如：赛博歌姬 Nova')}
            />

            <div className="voice-label">
              <span>{t('人物参考图')}</span>
              <label className="small-button upload-button">
                <Upload size={13} /> {t(charModal.image ? '更换人物图' : '上传人物图')}
                <input type="file" accept="image/png,image/jpeg,image/webp" onChange={handleModalImageUpload} />
              </label>
            </div>
            <div className="image-preview mv-char-modal-preview">
              {charModal.image ? (
                <img src={charModal.image} alt={charModal.name || t('人物参考图')} />
              ) : (
                <div>
                  <span>+</span>
                  <p>{t('上传 PNG / JPG / WebP 人物图（10 MB 以内）')}</p>
                </div>
              )}
            </div>

            <div className="voice-label">
              <label htmlFor="mv-char-prompt">{t('人物提示词（生图 / 角色设定描述）')}</label>
              {charModal.prompt?.trim() && (
                <button type="button" className="small-button" onClick={copyModalPrompt}>
                  {copiedPrompt ? <Check size={12} /> : <Copy size={12} />} {t(copiedPrompt ? '已复制提示词' : '复制提示词')}
                </button>
              )}
            </div>
            <textarea
              id="mv-char-prompt"
              className="voice-textarea"
              maxLength={4000}
              value={charModal.prompt}
              onChange={(e) => setCharModal((m) => ({ ...m, prompt: e.target.value }))}
              placeholder={t('写下人物的外貌、服装、风格与气质描述，方便复用于生图和分镜脚本…')}
            />

            {charModal.error && <p className="tts-error" role="alert">{t(charModal.error)}</p>}
          </form>
        </Modal>
      )}

      {/* Saved MV Projects Panel (Cloud & Local) */}
      <section className="cloud-projects mv-projects-panel">
        <div className="section-heading">
          <h2>{t(cloudEnabled ? '我的云端 MV 项目' : '我的 MV 项目')}</h2>
          <div className="speech-actions">
            {saveStatus && <span className="image-hint">{t(saveStatus)}</span>}
            <button type="button" className="small-button" onClick={startNewProject}>
              <Plus size={13} /> {t('新建 MV 项目')}
            </button>
            <button
              type="button"
              className="small-button"
              disabled={busyInput || (!session && !story && !Object.keys(shots).length && !lrcText.trim())}
              onClick={() => persistCurrentProject(false)}
            >
              <Save size={13} /> {t('立即保存')}
            </button>
            <button type="button" className="small-button" disabled={projectsLoading} onClick={refreshProjects}>
              <RefreshCw size={13} /> {t('刷新')}
            </button>
          </div>
        </div>
        {projects.length ? (
          <div className="mv-project-list">
            {projects.map((item) => (
              <div
                key={item.id}
                role="button"
                tabIndex={0}
                className={`cloud-project-row mv-project-row ${item.id === projectId ? 'is-current' : ''}`}
                onClick={() => openProject(item.id)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') openProject(item.id); }}
              >
                <div>
                  <strong>{item.title}</strong>
                  {item.id === projectId && <span className="mv-tag">{t('当前')}</span>}
                </div>
                <div className="mv-project-meta">
                  <span>
                    {item.sliceCount} {t('切片')} · {item.scriptedCount} {t('分镜')} · {item.completedVideos} {t('视频')} · {new Date(item.updatedAt).toLocaleString()}
                  </span>
                  <button
                    type="button"
                    className="small-button"
                    aria-label={t('删除项目')}
                    onClick={(e) => deleteProject(item.id, e)}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="image-hint">{t('生成 MV 脚本或编辑内容后，项目会自动保存，刷新页面不会丢失。')}</p>
        )}
      </section>

      <form onSubmit={handleStartMv}>
        <fieldset disabled={busyInput} className="brief-fieldset">
          {/* 01 MP3 & LRC Upload */}
          <section className="mv-section">
            <div className="section-heading">
              <h2><span>01</span>{t('上传歌曲与歌词')}</h2>
              <span className="section-note">{t('支持 MP3 / WAV 与带时间戳的 LRC 歌词')}</span>
            </div>

            <div className="mv-upload-grid">
              <div className="mv-upload-card">
                <div className="mv-upload-header">
                  <div>
                    <strong><Music size={15} /> {t('上传 MP3 歌曲')}</strong>
                    <p>{t('系统将按设定节奏自动精确切片，并保留原曲驱动 MiniMax H3 画面律动。')}</p>
                  </div>
                  <label className="small-button save-image upload-button">
                    <Upload size={13} /> {t(audioFile ? '更换音频' : '选择 MP3 / WAV')}
                    <input type="file" accept=".mp3,.wav,audio/mpeg,audio/wav" onChange={handleAudioUpload} />
                  </label>
                </div>
                {audioFile ? (
                  <div className="mv-audio-preview">
                    <div className="mv-audio-meta">
                      <span>{audioFile.name}</span>
                      <small>
                        {formatClock(audioFile.duration)} · {t('预计切分')} {estimatedSlices} {t('段')}（{pace}s/{t('镜')}）
                      </small>
                    </div>
                    {audioPreviewSrc && <audio controls src={audioPreviewSrc} />}
                  </div>
                ) : (
                  <div className="mv-empty-drop">{t('尚未上传音频文件（最大 35 MB，最长 10 分钟）')}</div>
                )}
              </div>

              <div className="mv-upload-card">
                <div className="mv-upload-header">
                  <div>
                    <strong><Sparkles size={15} /> {t('上传或粘贴 LRC 歌词')}</strong>
                    <p>
                      {lrcFileName
                        ? `${lrcFileName} · ${parsedLrc.lines.length} ${t('行时间戳歌词')}`
                        : parsedLrc.lines.length
                          ? `${t('已识别')} ${parsedLrc.lines.length} ${t('行时间戳歌词')}${parsedLrc.meta.title ? ` · ${parsedLrc.meta.title}` : ''}`
                          : t('支持 [00:12.34] 格式，也可留空由纯音乐节奏生成。')}
                    </p>
                  </div>
                  <label className="small-button upload-button">
                    <Upload size={13} /> {t('导入 .lrc 文件')}
                    <input type="file" accept=".lrc,.txt,text/plain" onChange={handleLrcUpload} />
                  </label>
                </div>
                <textarea
                  className="mv-lrc-textarea"
                  value={lrcText}
                  onChange={(e) => setLrcText(e.target.value)}
                  placeholder={t('[00:00.00][Intro] 深夜雨声与合成器前奏\n[00:15.20][Verse 1] 霓虹倒映在潮湿的街角...\n[00:45.00][Chorus] 我们穿过光影奔向黎明...')}
                />
              </div>
            </div>
          </section>

          {/* 02 Style, Genre & Pace */}
          <section className="style-section">
            <div className="section-heading">
              <h2><span>02</span>{t('选择画风与歌曲风格')}</h2>
              <span className="section-note">{t('决定整支 MV 的视觉质感与剪辑节奏')}</span>
            </div>
            <div className="style-grid" role="radiogroup" aria-label={t('MV 画风选择')}>
              {VISUAL_STYLES.map((s) => (
                <button
                  type="button"
                  role="radio"
                  aria-checked={visualStyle === s.id}
                  className={`style-card ${s.cls} ${visualStyle === s.id ? 'selected' : ''}`}
                  key={s.id}
                  onClick={() => setVisualStyle(s.id)}
                >
                  <div className="art" aria-hidden="true">
                    <span className="art-sun" />
                    <span className="art-building b1" />
                    <span className="art-building b2" />
                    <span className="art-building b3" />
                    <span className="art-floor" />
                    <span className="art-person" />
                    <span className="art-orbit" />
                  </div>
                  <span className="card-index">{s.en}</span>
                  <span className="selection">{visualStyle === s.id && <Check size={14} />}</span>
                  <div className="card-info">
                    <div>
                      <h3>{t(s.name)}</h3>
                      <p>{t(s.description)}</p>
                    </div>
                    <span className="style-number">{s.number}</span>
                  </div>
                </button>
              ))}
            </div>

            <div className="mv-subblock">
              <div className="mv-sublabel">{t('歌曲风格')}</div>
              <div className="mv-genre-grid" role="radiogroup" aria-label={t('歌曲风格')}>
                {MUSIC_GENRES.map((g) => (
                  <button
                    key={g.id}
                    type="button"
                    role="radio"
                    aria-checked={genre === g.id}
                    className={`mv-genre-pill ${genre === g.id ? 'active' : ''}`}
                    onClick={() => setGenre(g.id)}
                  >
                    <strong>{t(g.name)}</strong>
                    <span>{g.en}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="mv-subblock">
              <div className="mv-sublabel">{t('自动切片节奏与画幅')}</div>
              <div className="pace-grid" role="radiogroup" aria-label={t('切片节奏')}>
                {[5, 10].map((p) => (
                  <button
                    type="button"
                    role="radio"
                    aria-checked={pace === p}
                    className={`pace-option ${pace === p ? 'active' : ''}`}
                    key={p}
                    onClick={() => setPace(p)}
                  >
                    <span className="pace-icon">{p === 5 ? <Zap size={21} /> : <MoveRight size={24} />}</span>
                    <span className="pace-label">
                      <strong>{t(p === 5 ? '快节奏切片' : '慢节奏切片')}</strong>
                      <small>{t(p === 5 ? '紧凑卡点切换，适合燃系/电子/流行' : '长镜头情绪流动，适合抒情/古风/电影感')}</small>
                    </span>
                    <span className="seconds">{p}<small>{t('秒 / 镜头')}</small></span>
                    <span className="radio-dot" />
                  </button>
                ))}
              </div>
              <div className="mv-aspect-row">
                <span>{t('MV 画幅')}：</span>
                {['16:9', '9:16', '21:9', '1:1'].map((ratio) => (
                  <button
                    key={ratio}
                    type="button"
                    className={`small-button ${aspect === ratio ? 'save-image' : ''}`}
                    onClick={() => setAspect(ratio)}
                  >
                    {ratio}
                  </button>
                ))}
              </div>
            </div>
          </section>

          {/* 03 Optional Inspiration */}
          <section className="content-section">
            <div className="section-heading">
              <h2><span>03</span><label htmlFor="mv-inspiration">{t('MV 叙述感觉 / 灵感（可选）')}</label></h2>
              <span className="section-note">{t('告诉 AI 你想要的剧情氛围、意象或情绪转折')}</span>
            </div>
            <div className="text-wrap">
              <textarea
                id="mv-inspiration"
                maxLength={4000}
                value={inspiration}
                onChange={(e) => setInspiration(e.target.value)}
                placeholder={t('例如：一位孤独的未来旅人在雨夜霓虹都市中寻找记忆碎片，副歌时推开天台之门，城市灯光化作金色星海……（留空则由 AI 根据歌词自动构思故事）')}
              />
              <div className="textarea-footer">
                <span><span className="tiny-square" /> {t('将与歌词时间轴深度融合生成逐条分镜')}</span>
                <span>{inspiration.length} / 4,000</span>
              </div>
            </div>
          </section>

          {/* 04 Cloud-Saved Character Library (Multi-select + Add + Edit) */}
          <section className="mv-section">
            <div className="section-heading">
              <h2><span>04</span>{t('我的参考人物')}</h2>
              <div className="speech-actions">
                <span className="section-note">{t('云端保存，点击卡片可多选（最多 4 位）')}</span>
                <button type="button" className="small-button save-image" onClick={openAddCharacter}>
                  <Plus size={13} /> {t('添加人物')}
                </button>
              </div>
            </div>

            {characters.length > 0 ? (
              <div className="mv-preset-grid">
                {characters.map((character) => {
                  const selected = selectedCharIds.includes(character.id);
                  return (
                    <div
                      key={character.id}
                      role="checkbox"
                      aria-checked={selected}
                      tabIndex={0}
                      className={`mv-preset-card mv-char-card ${selected ? 'selected' : ''}`}
                      onClick={() => toggleCharacterSelect(character.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          toggleCharacterSelect(character.id);
                        }
                      }}
                    >
                      {character.image && <img src={character.image} alt={character.name} />}
                      <span className="selection">{selected && <Check size={13} />}</span>
                      <div className="mv-preset-info mv-char-card-body">
                        <div className="mv-char-card-text">
                          <strong>{character.name}</strong>
                          <small className="mv-char-prompt-snippet">
                            {character.prompt || t('暂未填写提示词，点击右下角编辑')}
                          </small>
                        </div>
                        <button
                          type="button"
                          className="small-button mv-char-edit-btn"
                          onClick={(e) => openEditCharacter(character, e)}
                        >
                          <Edit3 size={12} /> {t('编辑')}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="mv-char-empty">
                <p>{t(charactersLoading ? '正在加载云端人物库…' : '还没有保存的参考人物。上传你的人物图与提示词，即可在多个 MV 中复用。')}</p>
                {!charactersLoading && (
                  <div className="speech-actions">
                    <button type="button" className="small-button save-image" onClick={openAddCharacter}>
                      <Plus size={13} /> {t('添加人物')}
                    </button>
                    <button type="button" className="small-button" onClick={seedStarterCharacters}>
                      <Sparkles size={13} /> {t('载入示例人物')}
                    </button>
                  </div>
                )}
              </div>
            )}
          </section>
        </fieldset>

        <div className="mv-auto-row">
          <span className="draft-note">
            <span />
            {t('先逐条生成「分镜动态提示词」供审阅与朗读检查，确认后再点击「生成全部」启动 MiniMax H3')}
          </span>
          <button className="submit" type="submit" disabled={busyInput || (!audioFile && !session?.masterAudioUrl)}>
            {busyInput ? <LoaderCircle className="spin" size={18} /> : <Wand2 size={18} />}
            {t(phase === 'slicing' ? '正在切片音频…' : phase === 'scripting' ? '正在逐条输出脚本…' : '自动切片并生成 MV 脚本')}
          </button>
        </div>

        {error && <div className="feedback error" role="alert">{t(error)}</div>}
      </form>

      {/* Live Streaming Story + Timeline + MiniMax H3 Studio */}
      {(session || phase === 'scripting') && (
        <section className="mv-workspace">
          <div className="mv-workspace-header">
            <div>
              <div className="eyebrow"><span /> MUSIC VIDEO PRODUCTION</div>
              <h2>{story?.title || session?.meta?.title || t('正在构思 MV 故事…')}</h2>
              <p className="speech-status" role="status">
                {t(statusMsg)}
                {scriptProgress.total > 0 && ` · ${scriptProgress.completed}/${scriptProgress.total}`}
              </p>
            </div>
            <div className="speech-actions">
              {videoConfig?.choices && (
                <label className="mv-video-model">
                  <span>{t('视频模型')}</span>
                  <select
                    value={selectedVideoModel?.id || videoConfig.defaultModel}
                    disabled={videoBusy}
                    onChange={(event) => setVideoModel(event.target.value)}
                  >
                    {videoConfig.choices.map((choice) => (
                      <option key={choice.id} value={choice.id}>
                        {choice.label}{choice.rate ? '' : ` · ${t('暂不可用')}`}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {videoBusy ? (
                <button type="button" className="small-button generation-stop" onClick={stopVideoGeneration}>
                  <Square size={13} /> {t('停止 H3 生成')}
                </button>
              ) : (
                <button
                  type="button"
                  className="small-button save-image"
                  disabled={busyInput || !allScriptedIndices.length || !canGenerateVideo}
                  onClick={() => requestVideoGeneration(batchVideoIndices)}
                >
                  <Video size={14} /> {t(completedVideoEntries.length && pendingIndices.length ? '继续生成剩余 H3 视频' : '生成全部')}
                </button>
              )}
              <button
                type="button"
                className="small-button"
                disabled={!completedVideoEntries.length}
                onClick={openPlaylist}
              >
                <Play size={13} /> {t('连续预览片段')} ({completedVideoEntries.length})
              </button>
              <button
                type="button"
                className="small-button"
                disabled={merging || videoBusy || !completedVideoEntries.length}
                onClick={handleMergeMv}
              >
                <Layers size={13} /> {t(merging ? '正在合成完整 MV…' : '一键合成完整 MV')}
              </button>
              <button
                type="button"
                className="small-button"
                disabled={packing || !completedVideoEntries.length}
                onClick={handleZipVideos}
              >
                <Download size={13} /> {t(packing ? '正在打包…' : '下载 ZIP')}
              </button>
            </div>
          </div>

          {videoServiceMessage && (
            <p className="tts-error" role="alert">
              {t(videoServiceMessage)}{' '}
              <button type="button" className="small-button" onClick={loadVideoConfig}>{t('重新检查视频服务')}</button>
            </p>
          )}

          <p className="tts-note">
            {price
              ? `${selectedVideoModel.label} · ${formatVideoCost(price.per_second, price.currency)} / ${t('秒')}${batchVideoSeconds ? ` · ${t('预计')} ${formatVideoCost(batchVideoSeconds * Number(price.per_second), price.currency)}` : ''}`
              : t('MiniMax H3 · 768p · 原曲切片音频驱动')}
            {videoBusy && ` ${t('队列剩余')} ${queue.length} ${t('条')}。`}
            {videoMessage && ` ${t(videoMessage)}`}
          </p>

          {speechItems.length > 0 && (
            <div className="mv-speech-bar">
              <div className="speech-actions">
                <select
                  aria-label={t('朗读语言')}
                  value={speechLang}
                  onChange={(e) => setSpeechLang(e.target.value)}
                >
                  {Object.entries(SPEECH_LANGUAGES).map(([id, label]) => (
                    <option key={id} value={id}>{t(label)}</option>
                  ))}
                </select>
                <button
                  type="button"
                  className="small-button"
                  disabled={!reader.supported || !speechItems.length || busyInput}
                  onClick={() => reader.play(speechItems, speechLang)}
                >
                  <Volume2 size={13} /> {t('▶ 朗读全部脚本')}
                </button>
                <button
                  type="button"
                  className="small-button"
                  disabled={!speech.active}
                  onClick={() => reader.togglePause()}
                >
                  {t(speech.paused ? '继续' : '暂停')}
                </button>
                <button
                  type="button"
                  className="small-button"
                  disabled={!speech.active}
                  onClick={() => reader.stop()}
                >
                  {t('停止')}
                </button>
              </div>
              {speech.message && <span className="speech-status" role="status">{t(speech.message)}</span>}
            </div>
          )}

          {story && (
            <div className="mv-story-card">
              <div className="mv-story-badge"><Film size={14} /> {t('AI 导演故事大纲')}</div>
              <p className="mv-storyline">{story.storyline}</p>
              <div className="mv-story-meta">
                <span><strong>{t('视觉母题')}：</strong>{story.visual_theme}</span>
                <span><strong>{t('光影色彩')}：</strong>{story.color_palette}</span>
              </div>
            </div>
          )}

          {mergedUrl && (
            <div className="mv-merged-card">
              <div className="dialogue-heading">
                <h3>{t('完整合成 MV（已锁定原曲音轨）')}</h3>
                <a className="small-button save-image" href={mergedUrl} download={`${story?.title || 'music-mv'}.mp4`}>
                  <Download size={13} /> {t('下载完整 MV (MP4)')}
                </a>
              </div>
              <video controls src={mergedUrl} />
            </div>
          )}

          <div className="mv-shot-list">
            {slices.map((slice) => {
              const shot = shots[slice.index];
              const job = jobs[slice.index];
              const isQueued = queue.includes(slice.index);
              const shotSpeechKey = `mv-shot-${slice.index}`;
              const isSpeaking = speech.key === shotSpeechKey && speech.active;
              return (
                <article className={`project-article mv-shot-card ${shot ? 'is-ready' : 'is-pending'} ${isSpeaking ? 'speaking' : ''}`} key={slice.index}>
                  <div className="dialogue-heading">
                    <h3>
                      {slice.shotId}
                      <small>{slice.timestamp}</small>
                      <span className="mv-tag">{shot?.section || slice.section}</span>
                      {shot?.mood && <span className="mv-tag muted">{shot.mood}</span>}
                      {shot?.camera && <span className="mv-tag muted">{shot.camera}</span>}
                    </h3>
                    <div className="speech-actions">
                      {shot && (
                        <button
                          type="button"
                          className="small-button"
                          disabled={!reader.supported || !shot.video_prompt?.trim() || busyInput}
                          onClick={() => {
                            if (isSpeaking) reader.stop();
                            else {
                              reader.play(
                                [{ key: shotSpeechKey, label: `${slice.shotId} · ${shot.section || slice.section}`, text: shot.video_prompt.trim() }],
                                speechLang,
                              );
                            }
                          }}
                        >
                          {t(isSpeaking ? '■ 停止朗读' : '▶ 朗读脚本')}
                        </button>
                      )}
                      <button
                        type="button"
                        className="small-button"
                        disabled={videoBusy || busyInput || !shot || !canGenerateVideo}
                        onClick={() => requestVideoGeneration([slice.index])}
                      >
                        {t(job?.url ? '重新生成 H3' : '生成本段 H3')}
                      </button>
                    </div>
                  </div>

                  <div className="mv-slice-bar">
                    <span className="mv-lyric-text">♪ {slice.lyrics}</span>
                    {slice.audioUrl && <audio controls preload="none" src={slice.audioUrl} />}
                  </div>

                  {shot ? (
                    <div className="storyboard-layout">
                      <div>
                        <div className="mv-transition-note">
                          <strong>{t('转场设计')}：</strong>{shot.scene_transition}
                        </div>
                        <label className="voice-label" htmlFor={`mv-vp-${slice.index}`}>
                          {t('分镜动态提示词')} <span>{shot.video_prompt.length} / 6,000</span>
                        </label>
                        <textarea
                          id={`mv-vp-${slice.index}`}
                          className="voice-textarea mv-prompt-area"
                          value={shot.video_prompt}
                          disabled={videoBusy}
                          onChange={(e) => updateShot(slice.index, { video_prompt: e.target.value })}
                        />
                        <label className="voice-label" htmlFor={`mv-ip-${slice.index}`}>
                          {t('核心构图提示词')} <span>{shot.image_prompt.length} / 800</span>
                        </label>
                        <textarea
                          id={`mv-ip-${slice.index}`}
                          className="voice-textarea"
                          value={shot.image_prompt}
                          disabled={videoBusy}
                          onChange={(e) => updateShot(slice.index, { image_prompt: e.target.value })}
                        />
                        <div className="continuity-control">
                          <label>
                            <input
                              type="checkbox"
                              checked={shot.use_previous_frame === true}
                              disabled={slice.index === 0 || videoBusy}
                              onChange={(e) => updateShot(slice.index, { use_previous_frame: e.target.checked })}
                            />
                            {t('使用上一镜头尾帧作为起始衔接参考')}
                          </label>
                        </div>
                      </div>

                      <div className="video-preview-column">
                        <div className="video-preview">
                          {job?.url ? (
                            <video controls preload="metadata" src={job.url} />
                          ) : (
                            <div>
                              <span>{isQueued || (job && !isTerminal(job)) ? '◌' : '▶'}</span>
                              <p>{t(job ? STATUS_LABELS[job.status] || '正在处理视频任务' : isQueued ? '排队等待生成' : '等待生成 MiniMax H3 视频')}</p>
                              <small>MINIMAX H3 · {slice.duration}S · {aspect}</small>
                            </div>
                          )}
                        </div>
                        {job?.error && <p className="tts-error" role="alert">{t(job.error)}</p>}
                        {job?.url && (
                          <div className="mv-video-actions">
                            <a className="small-button" href={job.url} download={`${slice.shotId}.mp4`}>
                              {t('下载 MP4')}
                            </a>
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="mv-shot-skeleton">
                      <LoaderCircle className="spin" size={16} />
                      <span>{t('正在等待 AI 逐条输出此切片的分镜脚本…')}</span>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
