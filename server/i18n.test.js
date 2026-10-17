import test from 'node:test';
import assert from 'node:assert/strict';
import messages from '../src/translations.json' with {type:'json'};
import {translate,LOCALES} from '../src/i18n.js';
test('every UI message has English and Japanese translations with matching interpolation slots',()=>{
 assert.deepEqual(LOCALES,['zh-CN','en','ja']);
 const slots=s=>[...new Set(s.match(/\{\d+\}/g)||[])].sort();
 for(const [key,entry]of Object.entries(messages))for(const locale of ['en','ja']){
  assert.ok(entry[locale]?.trim(),`${locale} missing: ${key}`);
  assert.deepEqual(slots(entry[locale]),slots(key),`${locale} interpolation mismatch: ${key}`);
 }
});
test('dynamic generation and error messages translate while preserving IDs, counts and user names',()=>{
 assert.equal(translate('生成中 · 已处理 2 / 12 条','en'),'Generating · Processed 2 / 12');
 assert.equal(translate('配音处理完成：成功 2 条，失败 1 条，可逐条重试。','en'),'Voice processing complete: 2 succeeded, 1 failed; retry individually.');
 assert.equal(translate('请在人物展示中上传并保存图片：林月。','ja'),'キャラクター画面で画像をアップロードして保存してください：林月。');
 assert.equal(translate('正在生成 1/3 · SHOT-001','ja'),'生成中 1/3 · SHOT-001');
 assert.equal(translate('已生成 · 晓晓 · 中文女声','en'),'Generated · Xiaoxiao · Chinese female');
});
test('Chinese mode and unknown content are unchanged; switching languages is reversible',()=>{
 const original='生成全部动画';assert.equal(translate(original,'en'),'Generate all videos');assert.equal(translate(original,'ja'),'動画をすべて生成');assert.equal(translate(original,'zh-CN'),original);
 for(const locale of LOCALES)assert.equal(translate('银发少女穿过森林。保持人物一致。',locale),'银发少女穿过森林。保持人物一致。');
 assert.equal(translate(undefined,'ja'),undefined);assert.equal(translate(original,'unsupported'),original);
});
