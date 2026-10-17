Here is the complete English translation of your prompt sequence, accurately rendered and structured step-by-step:

---

Next, I am going to build a functional web application for a director's control console. Let's build it step by step, going from shallow to deep.

First, let's create an landing/entry interface with the following layout:

1. **Art Style Selection**: Realistic 3D, Japanese Anime, 2.5D Effect
2. **Animation Pace Selection**: Fast Pace (5s), Slow Pace (10s)
3. **Content Input**: Large `textarea`
4. **Button**: "Help Me Pitch a Script"

**Theme & Aesthetics**: Black background, fluorescent green as the main accent color, white font, with an overall cool/sleek design.

Since it will need to communicate with a local CLI later, please consider whether to use React, SvelteKit, or another framework capable of interacting with the backend.

---

Alright, here comes the fun part, which is also the main challenge of this program.

You will combine the selected art style, pace settings, and your creative inspiration into a prompt text. Then, via the `aiand` command-line tool installed on my local computer, invoke the locally installed skill `direct-h3-storyboards` to execute it. Once completed, `direct-h3-storyboards` will return a JSON object, which you will then pass back to my web application. Finally, my website will visualize the returned data, referencing my existing site `001_CloudJsonView`.

* **`aiand` Official Docs**: [https://docs.aiand.com/](https://docs.aiand.com/)
* This time, we will use the `deepseek-ai/deepseek-v4.1-flash` model via `aiand`.
* **`aiand` API key**: `YOUR API KEY`

---

Great, now let's make some visual and UI adjustments:

1. **Pagination / Page Switching**
When the user clicks "Help Me Pitch a Script", switch to a new page dedicated to AI processing. Once processing completes, navigate to a new screen displaying the "Creative Proposal" (including Character Showcase, Voice Showcase, etc.), rather than staying on the same page or turning into a long scrollable page.
2. **Display AI Processing Status**
During communication with the AI skill, the waiting time is relatively long and users won't know what is currently happening. Please add text status indicators on the page (e.g., "What is currently being done") so users can monitor progress.

---

Next UI revisions:

* Hide "Creative Proposal" completely and display "Character Showcase" directly.

**Changes to the "Character Showcase" page:**

* Add a small "Copy" button to the right of "Character Profile / Image Prompt" to copy the current prompt.
* Adjust the layout of the prompt line: left side displays the prompt, right side features an image upload control. The goal is to copy the prompt, generate an image on an external service, and upload it back here. Thus, it needs upload, display, and save capabilities.
* Hide "Reference Setup Board" and "Fixed Voice Timber/Tone".

**Changes to the "Voice Design" page:**

* Hide all "BGM / Music Design" elements.
* Reference `001_CloudJsonView` to implement "Read All" and "Read Item-by-Item" preview/playback features.
* Hide "Voice Plan".

---

Next, let's add a slightly more challenging feature.

On the "Voice Design" page, I want to use `edge-tts` to generate voiceovers.

I assume this should be handled when connecting with the backend, but I'll leave the implementation details to you.

**On-screen requirements:**

1. A "Generate All Voiceovers" button.
2. A small "Generate Voiceover" button for each individual entry.
3. Every voiceover text should be editable (`textarea`).

---

Next, let's add another challenging feature on the "Storyboard Showcase" page.

I want to use `Videos` provided by `ai&` (specifically "MiniMax H3 video") to produce "MP4 with audio at 768p" animations.

* **Specific Docs**: [https://docs.aiand.com/api/videos/](https://docs.aiand.com/api/videos/)
This should also be completed in backend integration, but I'll leave the specific implementation to you.

**On-screen requirements:**

1. A "Generate All Animations" button.
2. A small "Generate Animation" button for each storyboard frame.
3. Each "Storyboard" / "First Frame Prompt" should be editable (`textarea`).
4. On the storyboard prompt line: left side displays the prompt, right side displays the generated animation preview.

Once all generation is complete, add a "Download Generated Animations" feature that packages them into a `.zip` file for download.

Similarly, on the "Voice Design" page, add a "Download Generated Voiceovers" feature that packages them into a `.zip` file for download.

---

Could you add a feature to load JSON files? Sometimes after system changes, re-generating everything costs too much money. Saving the JSON and being able to load an existing JSON at startup would save costs.

The JSON should record modified information, generation file paths, etc.

---

Next, we need to modify the video generation logic for MiniMax H3. The logic is as follows:

1. Use my generated voiceover audio as the main reference.
2. If the prompt specifies a character, also include that character's image as a reference.
3. Pass in the storyboard prompt.
4. Generate the video.

---

Currently, I noticed that it's not generating the animation according to my voiceover. For the generated clip `SHOT-001`, it neither referenced my voiceover nor referenced my specified character. What is causing this issue? Please help me resolve it.

---

Please refine some UI details:

1. **Voice Design**
* Clicking "Generate All Voiceovers" triggers a pop-up modal showing "Generating...".
* Progress list updates: "Item 1 completed", "Item 2 completed", "Item 3 completed", etc., to keep the user informed.
* Automatically close the pop-up modal once all items are finished.
* Place a "Stop" (Cancel) button at the bottom-right to abort the operation.
* Individual "Generate Voiceover" buttons should work similarly: trigger a slide-in/pop-up showing "Generating...", with a "Stop" button at the bottom-right to abort.


2. **Storyboard Showcase**
* Clicking "Generate All Animations" triggers a pop-up modal.
* Progress list shows: "Shot 1", "Shot 2", "Shot 3", "Shot 4", etc.
* Include an "Abort All" button.
* Individual "Generate Animation" buttons work similarly: pop up displaying "Generating...", with a "Stop / Pause / Abort" button at the bottom-right.


3. **Confirmation Logic for "Generate All Animations"**
* After pressing "Generate All Animations", show a prompt dialog first:
* Button 1: "Continue Generation" (preserves previously generated content)
* Button 2: "Regenerate From Scratch"


* Proceed to the generation queue only after the user selects a button.



---

I would like to add multi-language support. Currently, it only supports Chinese. Please add a button at the bottom-right corner to toggle between English and Japanese versions. Please implement this feature and help translate the relevant UI copy within the tool.

---

Next is a somewhat complex requirement:

After generating audio voiceovers, we need to add a duration validation step to verify if the generated audio length matches the script requirements (e.g., 5 seconds or 10 seconds).

Because validation will take place when uploading videos later, a duration mismatch will cause validation to fail, making troubleshooting tedious. Therefore, if the generated voiceover duration exceeds the requirement, automatically calculate the speed multiplier, speed up the audio, and re-generate a new voiceover file that matches the required video duration exactly.

Please incorporate this logic into the voiceover generation workflow.

---

Awesome! Next, I plan to make the GitHub repository public. Do I need to include information regarding Skills? If so, please include the Skills within my project directory as well.

Additionally, please rewrite the `README.md` in English detailing how to launch the project with the following steps:

1. Install Skills in the project directory
2. Fill in the API key inside the `.env` file
3. Execute `npm run dev` to start the project

Please write a well-structured English version of `README.md` for me.