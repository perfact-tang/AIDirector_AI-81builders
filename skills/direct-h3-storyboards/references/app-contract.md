# 当前表单与运行契约

输入：style 为 realistic-3d / anime / 2.5d / cyberpunk / ink-wash / pixar-clay / oil-painting / watercolor / film-noir，pace 为 5 或 10，content 为源文。所有镜头必须使用 pace；后端精确计算连续时间线与总时长。

输出顶层：schema="mv-maker-project"，schema_version=4，exported_at，project。
project：proposal_id（数字）、direction_name、director_plan、characters、storyboard。
director_plan：style_name、aspect_ratio="16:9"、visual_style_lock={shared_style_prefix,shared_negative_prompt}、total_duration_seconds、allowed_clip_durations_seconds。
characters[]：character_id="CHAR-001"、name、role、description（完整中文生图提示词）。可保留 aliases。不生成虚假的图片 URL。
storyboard[]：segment_id、content_narrative、movielength、mvinfo。
mvinfo[]：shot_id="SHOT-001"、character_refs=["CHAR-001"]（空镜为 []）、source_text、image_prompt（1–800 字，描述本镜独特景别/机位/场景构图，不得与上一镜雷同）、video_prompt（1–6000 字，描述文字转场+起势到结束的明确动作与运镜变化，不得与上一镜雷同）、audio_plan={audio_text:自然口语化对白或解说旁白,duration_seconds:pace}、generation_plan={duration_seconds:pace,audio_mode:"drive-audio",use_previous_frame:false}。

中文生产提示词；姓名、对白、歌词保留源语言。每个镜头都必须提供当前 Edge TTS 可朗读的自然口语 `audio_text`（5 秒约 16–24 字、10 秒约 34–48 字），不要写 (No dialogue)、S1 标记、画面元描述或虚构音频文件。配音过长拆镜；程序会测量实际音频，拒绝截断。

character_refs 是画面人物身份的唯一依据；speaker 是音频身份，不代表画面人物。空镜需要用户提供场景图才能提交动画。
`SHOT-001` 的 `use_previous_frame` 必须为 `false`。切新场景、切话题或大换景别时 `use_previous_frame` 必须为 `false`，并在 `video_prompt` 中用文字写清转场和全新空间；仅同场景连续动作才开启 `use_previous_frame: true`（连续不超过 2 镜），且明确描述脱离尾帧后的新动作与运镜演进。

人物图由用户在外部生成；应用提供 description 供复制、上传图片、预览和保存。图片绑定稳定 character_id，不因姓名重合、提示词修改或人物排序变化而绑定其他人。
