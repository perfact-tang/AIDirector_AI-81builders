import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import { VISUAL_STYLES, VISUAL_STYLE_IDS } from '../src/visual-styles.js';
import { briefText } from './director.js';
import { validateAppProject } from '../src/project-contract.js';
import { compileVideoPrompt } from '../src/compiled-video-prompt.js';
import { parseLrc, buildMvSlices } from '../src/mv-lrc.js';
import { mvRouter, extractJsonObjects } from './mv.js';
import { mediaTool, decodedAudioDuration } from './media-tools.js';

const template = JSON.parse(await readFile(new URL('../skills/direct-h3-storyboards/assets/app-project-template.json', import.meta.url)));

test('at least 9 visual styles are registered and included in briefText with narration and anti-duplication guidance', () => {
  assert.ok(VISUAL_STYLES.length >= 9);
  for (const id of ['realistic-3d', 'anime', '2.5d', 'cyberpunk', 'ink-wash', 'pixar-clay', 'oil-painting', 'watercolor', 'film-noir']) {
    assert.ok(VISUAL_STYLE_IDS.includes(id), `missing style ${id}`);
    const text = briefText({ style: id, pace: 5, content: '测试故事' });
    assert.match(text, /narration-style\.md/);
    assert.match(text, /严禁重复/);
  }
});

test('validateAppProject checkVariety rejects consecutive duplicate prompts and excessive continuity', () => {
  const data = structuredClone(template);
  const s1 = data.project.storyboard[0].mvinfo[0];
  s1.image_prompt = '深夜昏暗书房中景，主角站在书桌前翻开笔记本，左上方冷白台灯光照射桌面。';
  s1.video_prompt = '中景镜头缓慢推近，主角双手翻开书桌上的笔记本，眉头微皱开始阅读。';
  const s2 = structuredClone(s1);
  s2.shot_id = 'SHOT-002';
  data.project.storyboard[0].mvinfo.push(s2);

  const errors = validateAppProject(data, { pace: 5, checkVariety: true });
  assert.ok(errors.some((e) => e.includes('image_prompt') && e.includes('高度重复')));
  assert.ok(errors.some((e) => e.includes('video_prompt') && e.includes('高度重复')));

  // Distinct second shot passes
  s2.image_prompt = '高角度俯拍企业档案大厅，发光数据光带在成排书架之间穿梭，空间开阔明亮。';
  s2.video_prompt = '【硬切新场景】俯拍镜头向前俯冲，青蓝光带顺着档案架迅速汇聚到中央终端，点亮检索结果。';
  assert.deepEqual(validateAppProject(data, { pace: 5, checkVariety: true }), []);

  // SHOT-001 cannot use_previous_frame
  s1.generation_plan.use_previous_frame = true;
  assert.ok(validateAppProject(data, { pace: 5, checkVariety: true }).some((e) => e.includes('首个镜头不能启用')));
});

test('compileVideoPrompt prevents tail-frame freeze and supports music MV audio mode', () => {
  const cont = compileVideoPrompt({
    prompt: '主角转身推开天台铁门，镜头拉远展现霓虹雨夜城市。',
    firstPrompt: '天台开阔远景，雨滴在霓虹光中反光。',
    characters: [{ name: 'Nova' }],
    image: 'data:image/jpeg;base64,AA==',
    continuity: { sourceIndex: 0 },
    audioMode: 'music',
  });
  assert.match(cont, /仅作为本镜头 0\.00 秒起始衔接参考/);
  assert.match(cont, /禁止停留在上一帧静止画面/);
  assert.match(cont, /音乐 MV 的原曲切片/);
});

test('parseLrc and buildMvSlices align timestamped lyrics to 5s and 10s slices', () => {
  const sample = `[ti:Night Drive]
[ar:Nova]
[00:00.00][Intro]
[00:06.50][Verse 1]Rain on the neon glass
[00:11.20]Chasing the midnight train
[00:22.00][Chorus]We fly above the skyline`;
  const parsed = parseLrc(sample);
  assert.equal(parsed.meta.title, 'Night Drive');
  assert.equal(parsed.meta.artist, 'Nova');
  assert.equal(parsed.lines.length, 4);

  const slices5 = buildMvSlices({ durationSeconds: 26, pace: 5, lrcLines: parsed.lines });
  assert.equal(slices5.length, 6);
  assert.equal(slices5[0].lyrics, '[纯音乐 / 间奏]');
  assert.equal(slices5[1].section, 'Verse 1');
  assert.match(slices5[1].lyrics, /Rain on the neon glass/);
  assert.match(slices5[2].lyrics, /Chasing the midnight train/);
  assert.equal(slices5[4].section, 'Chorus');
  assert.match(slices5[4].lyrics, /We fly above the skyline/);

  const slices10 = buildMvSlices({ durationSeconds: 26, pace: 10, lrcLines: parsed.lines });
  assert.equal(slices10.length, 3);
  assert.match(slices10[0].lyrics, /Rain on the neon glass/);
});

test('extractJsonObjects parses streamed NDJSON across arbitrary chunk splits', () => {
  const chunk1 = '{"type":"story","title":"雨夜"} \n {"type":"shot","index":0,"video_pro';
  const r1 = extractJsonObjects(chunk1);
  assert.equal(r1.objects.length, 1);
  assert.equal(r1.objects[0].title, '雨夜');

  const chunk2 = r1.rest + 'mpt":"推进镜头"}';
  const r2 = extractJsonObjects(chunk2);
  assert.equal(r2.objects.length, 1);
  assert.equal(r2.objects[0].index, 0);
});

test('MV router slices MP3, streams storyboard script via SSE, and merges final MV with master audio', async (t) => {
  try { await mediaTool('ffmpeg', ['-version']); } catch { t.skip('FFmpeg not installed'); return; }
  const folder = await mkdtemp(path.join(tmpdir(), 'mv-test-'));
  const videoFolder = path.join(folder, 'videos');
  const prevKey = process.env.AIAND_API_KEY;
  process.env.AIAND_API_KEY = 'test-key';

  const mockStreamRequest = async () => {
    const ndjsonLines = [
      JSON.stringify({ type: 'story', title: '霓虹归途', storyline: '主角穿越雨夜都市寻找微光。', visual_theme: '雨夜霓虹', color_palette: '青蓝与洋红' }),
      JSON.stringify({ type: 'shot', index: 0, shot_id: 'MV-001', section: 'Intro', mood: '静谧', camera: '远景推进', scene_transition: '开场淡入', image_prompt: '雨夜霓虹天台远景，青蓝反光。', video_prompt: '远景缓慢推进，雨丝滑落天台栏杆，<Subject 1>背对镜头望向都市。', use_previous_frame: false }),
      JSON.stringify({ type: 'shot', index: 1, shot_id: 'MV-002', section: 'Chorus', mood: '爆发', camera: '低角度环绕', scene_transition: '硬切新场景', image_prompt: '街道仰拍特写，霓虹招牌折射水洼。', video_prompt: '【硬切新场景】低角度环绕镜头跟随<Subject 1>大步奔跑穿过水洼，光影飞速掠过。', use_previous_frame: false }),
    ].join('\n');

    const encoder = new TextEncoder();
    const body = new ReadableStream({
      start(controller) {
        for (let i = 0; i < ndjsonLines.length; i += 25) {
          const piece = ndjsonLines.slice(i, i + 25);
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: piece } }] })}\n\n`));
        }
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      },
    });
    return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  };

  const app = express();
  app.use('/api/mv', mvRouter({ folder: path.join(folder, 'mv'), videoFolder, request: mockStreamRequest }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    // 1. Generate a 9-second sine-wave MP3 and slice at 5s pace (should produce 2 slices)
    const sampleMp3 = path.join(folder, 'sample.mp3');
    await mediaTool('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=9', '-c:a', 'libmp3lame', '-b:a', '128k', sampleMp3]);
    const mp3Base64 = (await readFile(sampleMp3)).toString('base64');

    const sliceRes = await fetch(base + '/api/mv/slice', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        audioDataUrl: `data:audio/mpeg;base64,${mp3Base64}`,
        filename: 'neon-song.mp3',
        pace: 5,
        lrcText: '[ti:霓虹归途]\n[00:00.00][Intro]雨声落下\n[00:05.50][Chorus]奔向霓虹',
      }),
    });
    assert.equal(sliceRes.status, 200);
    const sliced = await sliceRes.json();
    assert.equal(sliced.slices.length, 2);
    assert.equal(sliced.meta.title, '霓虹归途');

    // Verify each sliced MP3 is accessible and strictly within <= 5.02s for MiniMax H3
    for (const s of sliced.slices) {
      const audioRes = await fetch(base + s.audioUrl);
      assert.equal(audioRes.status, 200);
      const localSlice = path.join(folder, 'mv', sliced.sessionId, `slice-${String(s.index).padStart(3, '0')}.mp3`);
      const dur = await decodedAudioDuration(localSlice);
      assert.ok(dur > 0 && dur <= 5.02, `slice ${s.index} duration ${dur} exceeds 5.02s`);
    }

    // 2. Stream script generation via SSE
    const streamRes = await fetch(base + '/api/mv/script-stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: sliced.meta.title,
        genre: 'electronic',
        visualStyle: 'cyberpunk',
        pace: 5,
        inspiration: '雨夜寻光',
        characters: [{ name: 'Nova', role: 'MV 主角' }],
        slices: sliced.slices,
      }),
    });
    assert.equal(streamRes.status, 200);
    const sseText = await streamRes.text();
    assert.match(sseText, /event: story/);
    assert.match(sseText, /霓虹归途/);
    assert.match(sseText, /MV-001/);
    assert.match(sseText, /MV-002/);
    assert.match(sseText, /event: done/);

    // 3. Merge two dummy MP4 clips + master MP3 into final MV MP4
    const clipA = 'mvclip_aaaaaaaaaaaaaaaa';
    const clipB = 'mvclip_bbbbbbbbbbbbbbbb';
    await mediaTool('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=64x64:d=5', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path.join(folder, 'a.mp4')]);
    await mediaTool('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=64x64:d=5', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path.join(folder, 'b.mp4')]);
    const { mkdir, copyFile } = await import('node:fs/promises');
    await mkdir(videoFolder, { recursive: true });
    await copyFile(path.join(folder, 'a.mp4'), path.join(videoFolder, clipA + '.mp4'));
    await copyFile(path.join(folder, 'b.mp4'), path.join(videoFolder, clipB + '.mp4'));

    const mergeRes = await fetch(base + '/api/mv/merge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: sliced.sessionId, videoIds: [clipA, clipB] }),
    });
    assert.equal(mergeRes.status, 200);
    const merged = await mergeRes.json();
    assert.match(merged.url, /^\/api\/mv\/merged\//);
    const mergedFileRes = await fetch(base + merged.url);
    assert.equal(mergedFileRes.status, 200);
    const mergedBytes = await mergedFileRes.arrayBuffer();
    assert.ok(mergedBytes.byteLength > 1000);
  } finally {
    if (prevKey === undefined) delete process.env.AIAND_API_KEY;
    else process.env.AIAND_API_KEY = prevKey;
    await new Promise((r) => server.close(r));
    await rm(folder, { recursive: true, force: true });
  }
});

test('MV projects and cloud character library persist, edit, list, and delete cleanly', async () => {
  const { fakeBucket } = await import('./test-support/fake-bucket.js');
  const { createCloudStore } = await import('./cloud-store.js');
  const folder = await mkdtemp(path.join(tmpdir(), 'mv-cloud-test-'));
  const bucket = fakeBucket();
  const app = express();
  app.use('/api/mv', mvRouter({ folder, getStore: () => createCloudStore(bucket, 'user-mv-1') }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    // 1. Add a character with image + prompt
    const pngDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+X2dIAAAAASUVORK5CYII=';
    const createRes = await fetch(base + '/api/mv/characters', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '赛博歌姬 Nova', prompt: '银蓝短发，机能风外套', image: pngDataUrl }),
    });
    assert.equal(createRes.status, 200);
    const { character } = await createRes.json();
    assert.equal(character.name, '赛博歌姬 Nova');
    assert.equal(character.prompt, '银蓝短发，机能风外套');
    assert.equal(character.image, pngDataUrl);

    // 2. List characters and edit existing character's prompt without re-uploading image
    const listChars1 = await (await fetch(base + '/api/mv/characters')).json();
    assert.equal(listChars1.characters.length, 1);
    const editRes = await fetch(base + '/api/mv/characters', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: character.id, name: 'Nova 2.0', prompt: '升级版霓虹外套与光环' }),
    });
    assert.equal(editRes.status, 200);
    const edited = (await editRes.json()).character;
    assert.equal(edited.id, character.id);
    assert.equal(edited.name, 'Nova 2.0');
    assert.equal(edited.prompt, '升级版霓虹外套与光环');
    assert.equal(edited.image, pngDataUrl);

    // 3. Save an MV project, list it, reload it, then delete it
    const pid = 'mvproj_1234567890abcdef';
    const saveRes = await fetch(base + '/api/mv/projects/' + pid, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        audioName: 'night-drive.mp3',
        visualStyle: 'cyberpunk',
        genre: 'electronic',
        pace: 5,
        lrcText: '[00:00.00]Hello neon',
        selectedCharacterIds: [character.id],
        story: { title: '霓虹夜航', storyline: '穿梭未来城市' },
        session: { sessionId: '11111111-1111-1111-1111-111111111111', slices: [{ index: 0, shotId: 'MV-001' }] },
        shots: { 0: { index: 0, shot_id: 'MV-001', video_prompt: '推进雨夜街道' } },
      }),
    });
    assert.equal(saveRes.status, 200);

    const projectsList = await (await fetch(base + '/api/mv/projects')).json();
    assert.equal(projectsList.projects.length, 1);
    assert.equal(projectsList.projects[0].title, '霓虹夜航');
    assert.equal(projectsList.projects[0].sliceCount, 1);
    assert.equal(projectsList.projects[0].scriptedCount, 1);

    const loaded = await (await fetch(base + '/api/mv/projects/' + pid)).json();
    assert.equal(loaded.story.title, '霓虹夜航');
    assert.deepEqual(loaded.selectedCharacterIds, [character.id]);

    // 4. Delete both project and character
    assert.equal((await fetch(base + '/api/mv/projects/' + pid, { method: 'DELETE' })).status, 200);
    assert.equal((await fetch(base + '/api/mv/characters/' + character.id, { method: 'DELETE' })).status, 200);
    assert.equal((await (await fetch(base + '/api/mv/projects')).json()).projects.length, 0);
    assert.equal((await (await fetch(base + '/api/mv/characters')).json()).characters.length, 0);
  } finally {
    await new Promise((r) => server.close(r));
    await rm(folder, { recursive: true, force: true });
  }
});
