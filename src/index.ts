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
                const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${env.GEMINI_API_KEY}`;
                
                // --- وظیفه جدید: بررسی لاگین کاربر ---
                if (body.task === 'login') {
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
                    const topic = findInBrief(body.brief, ['topic', 'عنوان', 'موضوع']);
                    if (!topic) throw new Error("ستون موضوع اصلی یافت نشد.");
                    
                    const searchUrl = `https://www.googleapis.com/customsearch/v1?key=${env.GOOGLE_API_KEY}&cx=${env.GOOGLE_CSE_ID}&q=${encodeURIComponent(topic)}&num=5&gl=ir&hl=fa`;
                    const searchResponse = await fetch(searchUrl);
                    if (!searchResponse.ok) throw new Error(`خطا در Google Search API`);
                    
                    const searchData: any = await searchResponse.json();
                    const topTitles = searchData.items?.map((item: any) => item.title) || [];
                    if (topTitles.length === 0) throw new Error("هیچ عنوانی در گوگل یافت نشد.");
                    
                    const titlePrompt = `Based on topic "${topic}" and top 5 titles:\n${topTitles.join('\n')}\nSuggest one new SEO title.`;
                    const geminiResponse = await fetch(GEMINI_API_URL, { 
                        body: JSON.stringify({ contents: [{ parts: [{ text: titlePrompt }] }] }), 
                        headers: { 'Content-Type': 'application/json' }, 
                        method: 'POST' 
                    });
                    
                    if (!geminiResponse.ok) { 
                        const errorText = await geminiResponse.text(); 
                        throw new Error(`خطا در Gemini API: ${errorText}`);
                    }
                    
                    const geminiData: any = await geminiResponse.json();
                    const aiSuggestedTitle = geminiData.candidates?.[0]?.content.parts?.[0]?.text || "پاسخی از Gemini دریافت نشد.";
                    
                    return new Response(JSON.stringify({ 
                        original_topic: topic, 
                        source_titles: topTitles, 
                        ai_suggested_title: aiSuggestedTitle.trim() 
                    }), { 
                        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                    });
                }
                else if (body.task === 'generate_outline') {
                    const { final_title, top_titles, brief } = body;
                    if (!final_title || !top_titles || !brief) throw new Error("اطلاعات برای تولید سرفصل ناقص است.");
                    
                    const structuredBrief = getStructuredBrief(brief);
                    const word_count = findInBrief(brief, ['word', 'count', 'کلمات', 'تعداد']) || 1500;
                    
                    const outlinePrompt = `You are an SEO expert. Create a detailed outline in Persian for a blog post. 
CONTEXT: 
- Title: "${final_title}" 
- Brief: \n${structuredBrief} 
- Competitors: \n${top_titles.join('\n')}

INSTRUCTIONS: 
- Use Persian Markdown (##, ###)
- Create optimal structure: 3-5 H2 sections with 2-3 H3 subheadings each
- The outline must support an article of ~${word_count} words
- Return ONLY the Markdown outline`;

                    const geminiResponse = await fetch(GEMINI_API_URL, { 
                        body: JSON.stringify({ contents: [{ parts: [{ text: outlinePrompt }] }] }), 
                        headers: { 'Content-Type': 'application/json' }, 
                        method: 'POST' 
                    });
                    
                    if (!geminiResponse.ok) throw new Error(`خطا در Gemini API برای تولید سرفصل`);
                    
                    const geminiData: any = await geminiResponse.json();
                    const generatedOutline = geminiData.candidates?.[0]?.content.parts?.[0]?.text || "پاسخی برای سرفصل از Gemini دریافت نشد.";
                    
                    return new Response(JSON.stringify({ generated_outline: generatedOutline }), { 
                        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                    });
                }
                else if (body.task === 'refine_outline') {
                    const { final_title, outline, refinement_prompt, brief } = body;
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
                    
                    const geminiResponse = await fetch(GEMINI_API_URL, { 
                        body: JSON.stringify({ contents: [{ parts: [{ text: refinePrompt }] }] }), 
                        headers: { 'Content-Type': 'application/json' }, 
                        method: 'POST' 
                    });
                    
                    if (!geminiResponse.ok) throw new Error(`خطا در ارتباط با Gemini API برای اصلاح سرفصل`);
                    
                    const geminiData: any = await geminiResponse.json();
                    const refinedOutline = geminiData.candidates?.[0]?.content.parts?.[0]?.text || "پاسخی برای اصلاح سرفصل از Gemini دریافت نشد.";
                    
                    return new Response(JSON.stringify({ generated_outline: refinedOutline }), { 
                        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                    });
                }
                else if (body.task === 'generate_article') {
                    const { final_title, outline, brief } = body;
                    if (!final_title || !outline || !brief) throw new Error("اطلاعات برای تولید مقاله ناقص است.");
                    
                    const structuredBrief = getStructuredBrief(brief);
                    const word_count = findInBrief(brief, ['word', 'count', 'کلمات', 'تعداد']) || 1500;
                    const brand_name = findInBrief(brief, ['brand', 'برند', 'نام برند']);
                    const faq_count = findInBrief(brief, ['faq', 'سوالات متداول', 'تعداد سوالات']) || 3;
                    const sourceUrl: string | null = findInBrief(brief, ['url']);
                    
                    let articlePrompt = '';

                    if (sourceUrl && sourceUrl.startsWith('http')) {
                        const response = await fetch(sourceUrl);
                        if (!response.ok) throw new Error(`دسترسی به URL برای آپدیت ممکن نبود: ${sourceUrl}`);
                        const htmlContent = await response.text();
                        const oldArticleText = stripHtml(htmlContent);

                        articlePrompt = `
Act as a professional SEO content writer. Your mission is to write a comprehensive Persian blog post that meets EXACT word count requirements.

---
**1. CORE REQUIREMENTS**
- **Primary Topic:** "${final_title}"
- **Target Word Count:** ${word_count} words MINIMUM
- **Content Brief:** \n${structuredBrief}

---
**2. AUTOMATIC WORD COUNT MANAGEMENT SYSTEM**

**PHASE 1: INITIAL ESTIMATION**
- Analyze the outline and estimate total word count
- If estimated words =< ${word_count}, proceed to PHASE 2

**PHASE 2: DYNAMIC CONTENT EXPANSION**
- **Option A:** Add 1 additional H2 section related to "${final_title}"
- **Option B:** Add 1-2 more H3 subheadings to existing H2 sections  
- **Option C:** Expand existing content with more details/examples
- **Option D:** Increase depth of introduction/conclusion sections

**PHASE 3: FINAL STRUCTURE OPTIMIZATION**
- Ensure structure contains:
  - ## مقدمه (150+ words)
  - 2-4 main H2 sections (each with 2-4 H3 subheadings)
  - ## نتیجه‌گیری (150+ words)
  - ## سوالات متداول

---
**3. CONTENT GENERATION RULES**

**A. Section Word Count Targets:**
- **H2 Introductory Paragraph:** 200-250 words each
- **H3 Subsections:** 100-150 words each
- **Introduction/Conclusion:** 150+ words each

**B. Content Quality Requirements:**
- All content must directly address "${final_title}"
- Provide deep, comprehensive coverage - avoid superficial treatment
- Use examples, data, and practical applications to expand content

**C. Brand Mention Protocol:**
${brand_name ? `- Mention "${brand_name}" exactly 2 times maximum` : '- No brand mention required'}

---
**4. EXECUTION PROTOCOL**

**Step 1:** Create initial structure with 2 H2 sections
**Step 2:** Estimate word count - if < ${word_count}, add more content
**Step 3:** Continuously monitor word count during writing
**Step 4:** If falling short, immediately add headings or expand content
**Step 5:** Final article must reach ${word_count} words minimum

**WORD COUNT GUARANTEE:** You are responsible for ensuring the final article meets the ${word_count} word target. Use dynamic expansion as needed.

Generate the article now using this adaptive system.
`;
                    }

                    const geminiResponse = await fetch(GEMINI_API_URL, { 
                        method: 'POST', 
                        headers: { 'Content-Type': 'application/json' }, 
                        body: JSON.stringify({ contents: [{ parts: [{ text: articlePrompt }] }] }) 
                    });
                    
                    if (!geminiResponse.ok) { 
                        const errorText = await geminiResponse.text(); 
                        throw new Error(`خطا در Gemini API برای تولید مقاله: ${errorText}`); 
                    }
                    
                    const geminiData: any = await geminiResponse.json();
                    const generatedArticle = geminiData.candidates?.[0]?.content.parts?.[0]?.text || "پاسخی برای مقاله از Gemini دریافت نشد.";
                    
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
}