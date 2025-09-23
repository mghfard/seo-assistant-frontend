// یک تابع کمکی ساده برای پاک‌سازی HTML و تبدیل آن به متن خام
function stripHtml(html: string): string {
    if (!html) return "";
    let clean = html.replace(/<script[^>]*>([\S\s]*?)<\/script>/gmi, '');
    clean = clean.replace(/<style[^>]*>([\S\s]*?)<\/style>/gmi, '');
    clean = clean.replace(/<\/div>|<\/li>|<\/ul>|<\/p>|<br\s*[\/]?>/ig, '\n');
    clean = clean.replace(/<li>/ig, '  * ');
    clean = clean.replace(/<[^>]+>/ig, '');
    clean = clean.replace(/(\r\n|\n|\r){2,}/gm, '\n').trim();
    return clean;
}

// توابع کمکی برای خواندن بریف
function findInBrief(brief: any, keys: string[]): string | null {
    if (!brief || !brief.headers || !brief.rowData) return null;
    for (let i = 0; i < brief.headers.length; i++) {
        const header = brief.headers[i];
        if (header && typeof header === 'string') {
            const lowerHeader = header.toLowerCase();
            for (const key of keys) {
                if (lowerHeader.includes(key)) {
                    return brief.rowData[i];
                }
            }
        }
    }
    return null;
}

function getStructuredBrief(brief: any): string {
    if (!brief || !brief.headers || !brief.rowData) return "";
    let structuredBrief = "";
    for (let i = 0; i < brief.headers.length; i++) {
        structuredBrief += `- ${brief.headers[i] || 'ستون خالی'}: ${brief.rowData[i] || 'داده خالی'}\n`;
    }
    return structuredBrief;
}

async function generateContent(prompt: string, model: string, env: Env): Promise<string> {
    const selectedModel = model || 'gemini-1.5-flash';

    switch (selectedModel) {
        case 'gemini-1.5-flash': {
            const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${env.GEMINI_API_KEY}`;
            const response = await fetch(GEMINI_API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
            });
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Gemini API Error: ${errorText}`);
            }
            const data: any = await response.json();
            return data.candidates?.[0]?.content.parts?.[0]?.text || "پاسخی از Gemini دریافت نشد.";
        }
            
        // این case دقیقاً با مقدار value در HTML جدید مطابقت دارد
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
                    // شناسه مدل به صورت ثابت روی نسخه‌ای که کار می‌کرد تنظیم شده است
                    model: 'openai/gpt-oss-20b', 
                }),
            });
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Groq API Error: ${errorText}`);
            }
            const data: any = await response.json();
            return data.choices?.[0]?.message?.content || "پاسخی از Groq دریافت نشد.";
        }

        default:
            // این خطا زمانی نمایش داده می‌شود که هماهنگی وجود نداشته باشد
            throw new Error(`مدل انتخاب شده نامعتبر است: ${selectedModel}`);
    }
}

export default {
    async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
        
        const corsHeaders = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
        };

        if (request.method === 'OPTIONS') {
            return new Response(null, { headers: corsHeaders });
        }

        if (request.method === 'POST') {
            try {
                const body: any = await request.json();
                
                if (body.task === 'login') {
                    // ... (بخش لاگین بدون تغییر)
                    const { username, password } = body;
                    if (!username || !password) {
                        throw new Error("نام کاربری یا رمز عبور ارسال نشده است.");
                    }
                    const storedPassword = await env.USERS.get(username);
                    if (storedPassword === null) {
                        throw new Error("کاربری با این نام یافت نشد.");
                    }
                    if (storedPassword === password) {
                        return new Response(JSON.stringify({ success: true }), { 
                            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                        });
                    } else {
                        throw new Error("رمز عبور اشتباه است.");
                    }
                }

                if (body.task === 'get_title_suggestions') {
                    // ... (این بخش بدون تغییر)
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
                        } else {
                             console.error("Google Search API failed, proceeding without competitor titles.");
                        }
                    }
                    let titlePrompt = topTitles.length > 0
                        ? `You are an expert SEO copywriter. Based on the main topic "${topic}" and the top 5 competitor titles from Google search:\n${topTitles.join('\n')}\n\nSuggest one new, superior, and SEO-friendly title in Persian that can outperform them. Return only the title text.`
                        : `You are an expert SEO copywriter. Based on the main topic "${topic}", suggest one creative and SEO-friendly title in Persian. Return only the title text.`;
                    
                    const aiSuggestedTitle = await generateContent(titlePrompt, model, env);

                    return new Response(JSON.stringify({
                        original_topic: topic,
                        source_titles: topTitles,
                        ai_suggested_title: aiSuggestedTitle.trim()
                    }), {
                        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                    });
                }
                
                else if (body.task === 'generate_outline') {
                    // ... (این بخش بدون تغییر)
                    const { final_title, top_titles, brief, model } = body;
                    if (!final_title || !brief) throw new Error("اطلاعات برای تولید سرفصل ناقص است.");
                    const structuredBrief = getStructuredBrief(brief);
                    const word_count = findInBrief(brief, ['word', 'count', 'کلمات', 'تعداد']) || '1500'; // دریافت به عنوان رشته
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
                    return new Response(JSON.stringify({ generated_outline: generatedOutline }), { 
                        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                    });
                }
                
                else if (body.task === 'refine_outline') {
                    // ... (این بخش بدون تغییر)
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
                    return new Response(JSON.stringify({ generated_outline: refinedOutline }), { 
                        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                    });
                }
                
                else if (body.task === 'generate_article') {
                    const { final_title, outline, brief, model } = body;
                    if (!final_title || !outline || !brief) throw new Error("اطلاعات برای تولید مقاله ناقص است.");
                    
                    const structuredBrief = getStructuredBrief(brief);
                    
                    // --- اصلاحیه ۱: تبدیل word_count به عدد ---
                    const word_count_str = findInBrief(brief, ['word', 'count', 'کلمات', 'تعداد']) || '1500';
                    const word_count = parseInt(word_count_str, 10);
                    
                    const brand_name = findInBrief(brief, ['brand', 'برند', 'نام برند']);
                    
                    // --- اصلاحیه ۲: تعریف مجدد متغیر faq_count ---
                    const faq_count_str = findInBrief(brief, ['faq', 'سوالات متداول', 'تعداد سوالات']) || '3';
                    const faq_count = parseInt(faq_count_str, 10);

                    const sourceUrl: string | null = findInBrief(brief, ['url']);
                    
                    let articlePrompt = '';

                    if (sourceUrl && sourceUrl.startsWith('http')) {
                        const response = await fetch(sourceUrl);
                        if (!response.ok) throw new Error(`دسترسی به URL برای آپدیت ممکن نبود: ${sourceUrl}`);
                        const htmlContent = await response.text();
                        const oldArticleText = stripHtml(htmlContent);

                        articlePrompt =`
You are a professional SEO content writer. Your mission is to write a comprehensive Persian blog post following these PRIORITY-BASED directives:
---
**PRIORITY 1: WORD COUNT - NON-NEGOTIABLE**
- **Primary Goal:** Article must be exactly ${word_count} words or MORE
- **Word Count Guarantee System:**
  1. First, calculate if you'll reach ${word_count} words
  2. If not, immediately add more headings/content
  3. Continuously monitor word count during writing
  4. If falling short, expand existing sections
---
**PRIORITY 2: FIXED INTRODUCTION & CONCLUSION STRUCTURE**
- ## مقدمه (150+ words) - MUST be first section
- ## نتیجه‌گیری (150+ words) - MUST be second-to-last section  
- ## سوالات متداول - MUST be last section
---
**PRIORITY 3: SMART HEADLINE SELECTION**
- From the outline, select only 2-3 H2s most relevant to "${final_title}"
- For each H2, select 2-3 H3 subheadings
- Add more H2/H3 only if needed to reach word count target
---
**EXECUTION PLAN:**
**Step 1: Word Count Calculation**
- Fixed sections: Introduction (150) + Conclusion (150) + FAQ (200) = 500 words
- Remaining for main content: ${word_count - 500} words
- Required H2 sections: Minimum ${Math.ceil((word_count - 500) / 400)} sections
**Step 2: Content Production with Real-time Monitoring**
- After each section, count words
- If behind schedule, make next section more detailed
**Step 3: Final Verification**
- Count total words before finishing
- If less than ${word_count}, add more content to existing sections
---
**CONTENT STRUCTURE:**
## مقدمه
[150+ words - directly address "${final_title}"]
## [H2 1 - relevant to main topic]
[200+ word introductory paragraph]
### [H3 1]
[150+ words]
### [H3 2] 
[150+ words]
## [H2 2 - relevant to main topic]
[200+ word introductory paragraph]
### [H3 1]
[150+ words]
### [H3 2]
[150+ words]
${word_count > 1200 ? `## [H2 3 - added for word count]
[200+ word introductory paragraph]
### [H3 1]
[150+ words]` : ''}
## نتیجه‌گیری
[150+ words - comprehensive summary]
## سوالات متداول
[${faq_count} questions with detailed answers]
---
**FINAL REQUIREMENT:**
Your article MUST reach minimum ${word_count} words. This is the primary evaluation criteria.
Generate the article now following these priority-based rules.
`;
                    } else {
                        articlePrompt = `You are a professional SEO content writer. Write a comprehensive, high-quality, and engaging blog post in Persian.
CONTEXT:
- Title: "${final_title}"
- Word Count: Approximately ${word_count} words
- Detailed Brief: \n${structuredBrief}
ARTICLE OUTLINE TO FOLLOW:
---
${outline}
---
INSTRUCTIONS:
- Follow the outline strictly.
- Write in a clear, informative, and engaging tone.
- Ensure the final article meets the target word count.
- Use Persian Markdown for headings (## for H2, ### for H3).
- Start with an introduction and end with a conclusion.
- Add a FAQ section with ${faq_count} relevant questions if appropriate.`;
                    }

                    const generatedArticle = await generateContent(articlePrompt, model, env);
                    return new Response(JSON.stringify({ generated_article: generatedArticle }), { 
                        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                    });
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

interface Env {
    USERS: KVNamespace;
    GEMINI_API_KEY: string;
    GOOGLE_API_KEY: string;
    GOOGLE_CSE_ID: string;
    GROQ_API_KEY: string; 
}