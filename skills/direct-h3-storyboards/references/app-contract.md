# 当前表单与运行契约

输入：style 为 realistic-3d / anime / 2.5d，pace 为5或10，content为源文。所有镜头必须使用pace；后端精确计算连续时间线与总时长。

输出顶层：schema="mv-maker-project"，schema_version=4，exported_at，project。
project：proposal_id（数字）、direction_name、director_plan、characters、storyboard。
director_plan：style_name、aspect_ratio="16:9"、visual_style_lock={shared_style_prefix,shared_negative_prompt}、total_duration_seconds、allowed_clip_durations_seconds。
characters[]：character_id="CHAR-001"、name、role、description（完整中文生图提示词）。可保留aliases。不生成虚假的图片URL。
storyboard[]：segment_id、content_narrative、movielength、mvinfo。
mvinfo[]：shot_id="SHOT-001"、character_refs=["CHAR-001"]（空镜为[]）、source_text、image_prompt（1–800字）、video_prompt（1–6000字）、audio_plan={audio_text:准确对白或简短旁白,duration_seconds:pace}、generation_plan={duration_seconds:pace,audio_mode:"drive-audio",use_previous_frame:false}。

中文生产提示词；姓名、对白、歌词保留源语言。每个镜头都必须提供当前Edge TTS可朗读的audio_text，不要写(No dialogue)、S1标记或虚构音频文件。配音过长拆镜；程序会测量实际音频，拒绝截断。

character_refs是画面人物身份的唯一依据；speaker是音频身份，不代表画面人物。空镜需要用户提供场景图才能提交动画。续接镜头可使用前镜头尾帧作为场景参考。

人物图由用户在外部生成；应用提供description供复制、上传图片、预览和保存。图片绑定稳定character_id，不因姓名重合、提示词修改或人物排序变化而绑定其他人。
