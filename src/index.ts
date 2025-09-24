// --- Helper Functions (No Change) ---
function stripHtml(html: string): string { if (!html) return ""; let clean = html.replace(/<script[^>]*>([\S\s]*?)<\/script>/gmi, ''); clean = clean.replace(/<style[^>]*>([\S\s]*?)<\/style>/gmi, ''); clean = clean.replace(/<\/div>|<\/li>|<\/ul>|<\/p>|<br\s*[\/]?>/ig, '\n'); clean = clean.replace(/<li>/ig, '  * '); clean = clean.replace(/<[^>]+>/ig, ''); clean = clean.replace(/(\r\n|\n|\r){2,}/gm, '\n').trim(); return clean; }
function findInBrief(brief: any, keys: string[]): string | null { if (!brief || !brief.headers || !brief.rowData) return null; for (let i = 0; i < brief.headers.length; i++) { const header = brief.headers[i]; if (header && typeof header === 'string') { const lowerHeader = header.trim().toLowerCase(); for (const key of keys) { if (lowerHeader.includes(key)) { return brief.rowData[i]; } } } } return null; }
function getStructuredBrief(brief: any): string { if (!brief || !brief.headers || !brief.rowData) return ""; let structuredBrief = ""; for (let i = 0; i < brief.headers.length; i++) { structuredBrief += `- ${brief.headers[i] || 'ستون خالی'}: ${brief.rowData[i] || 'داده خالی'}\n`; } return structuredBrief; }
function parseMainHeadings(outline: string): string[] { if (!outline) return []; return outline.split('\n').filter(line => line.trim().startsWith('## ')); }
function delay(ms: number) { return new Promise(resolve => setTimeout(resolve, ms)); }
function countWords(text: string): number { if (!text) return 0; return text.trim().split(/\s+/).length; }

// --- The 'generateContent' function is updated with Claude 3.5 Sonnet ---
async function generateContent(prompt: string, model: string, env: Env): Promise<string> {
    const selectedModel = model || 'gemini-1.5-flash';

    switch (selectedModel) {
        case 'gemini-1.5-flash': {
            const geminiKeys = [env.GEMINI_API_KEY, env.GEMINI_API_KEY_SECONDARY].filter(key => key);
            for (const key of geminiKeys) {
                try {
                    const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${key}`;
                    const response = await fetch(GEMINI_API_URL, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            contents: [{ parts: [{ text: prompt }] }],
                            generationConfig: { maxOutputTokens: 8192 }
                        }),
                    });
                    if (!response.ok) {
                        const errorText = await response.text();
                        throw new Error(`Key failed with status ${response.status}: ${errorText}`);
                    }
                    const data: any = await response.json();
                    return data.candidates?.[0]?.content.parts?.[0]?.text || "پاسخی از Gemini دریافت نشد.";
                } catch (error) {
                    console.error(`Attempt with a Gemini key failed:`, error);
                }
            }
            throw new Error("All available Gemini API keys failed.");
        }

        case 'groq-gpt-oss-20b': { 
            const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
            const response = await fetch(GROQ_API_URL, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${env.GROQ_API_KEY}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    messages: [{ role: 'user', content: prompt }],
                    model: 'qwen/qwen3-32b',
                    max_tokens: 4096 
                }),
            });
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Groq API Error: ${errorText}`);
            }
            const data: any = await response.json();
            return data.choices?.[0]?.message?.content || "پاسخی از Groq دریافت نشد.";
        }

        // --- NEW: Case for Claude 3.5 Sonnet ---
        case 'claude-3.5-sonnet': {
            const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
            const response = await fetch(ANTHROPIC_API_URL, {
                method: 'POST',
                headers: {
                    'x-api-key': env.ANTHROPIC_API_KEY,
                    'anthropic-version': '2023-06-01',
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    model: 'claude-3-5-sonnet-20240620',
                    max_tokens: 4096,
                    messages: [{ role: 'user', content: prompt }],
                }),
            });
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Anthropic API Error: ${errorText}`);
            }
            const data: any = await response.json();
            return data.content?.[0]?.text || "پاسخی از Claude دریافت نشد.";
        }

        default:
            throw new Error(`مدل انتخاب شده نامعتبر است: ${selectedModel}`);
    }
}

export default {
    async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
        
        const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
        if (request.method === 'OPTIONS') { return new Response(null, { headers: corsHeaders }); }

        if (request.method === 'POST') {
            try {
                const body: any = await request.json();
                
                if (body.task === 'login') {
                    const { username, password } = body;
                    if (!username || !password) throw new Error("نام کاربری یا رمز عبور ارسال نشده است.");
                    const storedPassword = await env.USERS.get(username);
                    if (storedPassword === null) throw new Error("کاربری با این نام یافت نشد.");
                    if (storedPassword === password) {
                        return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }});
                    } else { throw new Error("رمز عبور اشتباه است."); }
                }

                if (body.task === 'get_title_suggestions') {
                    const { brief, use_google_search, model } = body;
                    const topic = findInBrief(brief, ['topic', 'عنوان', 'موضوع']);
                    if (!topic) throw new Error("ستون موضوع اصلی یافت نشد.");
                    let topTitles: string[] = [];
                    if (use_google_search === true) {
                        const searchUrl = `https://www.googleapis.com/customsearch/v1?key=${env.GOOGLE_API_KEY}&cx=${env.GOOGLE_CSE_ID}&q=${encodeURIComponent(topic)}&num=5&gl=ir&hl=fa`;
                        const searchResponse = await fetch(searchUrl);
                        if (searchResponse.ok) {
                            const searchData: any = await searchResponse.json();
                            topTitles = searchData.items?.map((item: any) => item.title) || [];
                        } else { console.error("Google Search API failed."); }
                    }
                    let titlePrompt = topTitles.length > 0
                        ? `You are an expert SEO copywriter. Based on the main topic "${topic}" and the top 5 competitor titles from Google search:\n${topTitles.join('\n')}\n\nSuggest one new, superior, and SEO-friendly title in Persian that can outperform them. Return only the title text.`
                        : `You are an expert SEO copywriter. Based on the main topic "${topic}", suggest one creative and SEO-friendly title in Persian. Return only the title text.`;
                    
                    const aiSuggestedTitle = await generateContent(titlePrompt, model, env);

                    return new Response(JSON.stringify({
                        original_topic: topic,
                        source_titles: topTitles,
                        ai_suggested_title: aiSuggestedTitle.trim()
                    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
                }
                
                else if (body.task === 'generate_outline') {
                    const { final_title, top_titles, brief, model } = body;
                    if (!final_title || !brief) throw new Error("اطلاعات برای تولید سرفصل ناقص است.");
                    const structuredBrief = getStructuredBrief(brief);
                    const word_count = findInBrief(brief, ['word', 'count', 'کلمات', 'تعداد']) || '1500';
                    const outlinePrompt = `You are an SEO expert. Create a detailed outline in Persian for a blog post. 
CONTEXT: 
- Title: "${final_title}" 
- Brief: \n${structuredBrief} 
- Competitors: \n${(top_titles || []).join('\n')}

INSTRUCTIONS: 
- Use Persian Markdown (##, ###)
- Create optimal structure: 3-5 H2 sections with 2-3 H3 subheadings each
- The outline must support an article of ~${word_count} words
- Return ONLY the Markdown outline`;
                    const generatedOutline = await generateContent(outlinePrompt, model, env);
                    return new Response(JSON.stringify({ generated_outline: generatedOutline }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
                }
                
                else if (body.task === 'refine_outline') {
                    const { final_title, outline, refinement_prompt, brief, model } = body;
                    if (!final_title || !outline || !refinement_prompt || !brief) throw new Error("اطلاعات لازم برای اصلاح سرفصل ناقص است.");
                    const structuredBrief = getStructuredBrief(brief);
                    const refinePrompt = `
You are an expert content editor. A first draft of a blog post outline has been generated. The user has provided feedback to refine it.
CONTEXT:
- Final Approved Title: "${final_title}"
- Original Content Brief: \n${structuredBrief}
THE ORIGINAL OUTLINE (Version 1):
---
${outline}
---
USER'S INSTRUCTIONS FOR REFINEMENT:
---
"${refinement_prompt}"
---
YOUR TASK:
- Read the original outline and the user's instructions carefully.
- Generate a NEW AND IMPROVED outline that incorporates the user's feedback.
- The new outline must still be in Persian and use Markdown headings (## for H2, ### for H3).
- Maintain optimal structure: 3-5 H2 sections with 2-3 H3 subheadings each
- Return ONLY the new, complete Markdown outline. Do not add any other commentary.
`;
                    const refinedOutline = await generateContent(refinePrompt, model, env);
                    return new Response(JSON.stringify({ generated_outline: refinedOutline }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
                }
                
                else if (body.task === 'generate_article') {
                    const { final_title, outline, brief, model } = body;
                    if (!final_title || !outline || !brief) throw new Error("اطلاعات برای تولید مقاله ناقص است.");
                    
                    let total_word_count = 1500;
                    const word_count_str = findInBrief(brief, ['word', 'count', 'کلمات', 'تعداد']);
                    if (word_count_str) {
                        const parsed_count = parseInt(word_count_str, 10);
                        if (!isNaN(parsed_count)) {
                            total_word_count = parsed_count;
                        }
                    }

                    const headings = parseMainHeadings(outline);
                    if (headings.length === 0) throw new Error("هیچ سرفصل معتبری (##) در طرح کلی یافت نشد.");

                    let full_article = "";
                    let words_written_so_far = 0;
                    let previous_section_summary = "This is the first section of the article.";

                    for (let i = 0; i < headings.length; i++) {
                        const current_heading = headings[i];
                        const remaining_headings = headings.length - i;
                        const remaining_words = total_word_count - words_written_so_far;
                        const target_words_for_this_section = Math.max(150, Math.ceil(remaining_words / remaining_headings));

                        const section_prompt = `
You are a precise and disciplined SEO content writer. Your task is to write a single section for a larger article titled "${final_title}".
**Overall Goal:** The final article must be close to ${total_word_count} words.
**Words Written So Far:** ${words_written_so_far} words.
**Remaining Words to Write:** ${remaining_words} words.
**Your ONLY task now is to write the content for this specific heading:**
${current_heading}
**CRITICAL INSTRUCTION:**
- The word count for your response for THIS SECTION must be **STRICTLY around ${target_words_for_this_section} words**. Do not write significantly more or less.
- Your response must start directly with the heading (e.g., "${current_heading}").
- Maintain a professional tone consistent with the previous section summary: "${previous_section_summary}"
`;
                        const section_content = await generateContent(section_prompt, model, env);
                        
                        full_article += section_content + "\n\n";
                        words_written_so_far += countWords(section_content);
                        previous_section_summary = `The previous section covered "${current_heading}".`;

                        if (i < headings.length - 1) {
                            await delay(1000); 
                        }
                    }

                    return new Response(JSON.stringify({ generated_article: full_article }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
                }
                
                else {
                    throw new Error("وظیفه نامشخص است.");
                }

            } catch (error: any) {
                console.error("Worker Error:", error.stack);
                return new Response(JSON.stringify({ error: error.message }), { 
                    status: 500, 
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
            }
        }
        
        return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
    },
};

// --- The 'Env' interface is updated for the Claude API Key ---
interface Env {
    USERS: KVNamespace;
    GEMINI_API_KEY: string;
    GEMINI_API_KEY_SECONDARY: string;
    GOOGLE_API_KEY: string;
    GOOGLE_CSE_ID: string;
    GROQ_API_KEY: string;
    ANTHROPIC_API_KEY: string; // New key for Claude
}