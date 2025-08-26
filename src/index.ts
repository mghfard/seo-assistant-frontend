// =================================================================
// توابع کمکی (Helper Functions)
// =================================================================

/**
 * یک تابع کمکی ساده برای پاک‌سازی HTML و تبدیل آن به متن خام
 */
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

/**
 * یک مقدار خاص را بر اساس کلیدواژه‌های احتمالی از بریف پیدا می‌کند
 */
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

/**
 * یک متن ساختاریافته از کل بریف برای ارسال به هوش مصنوعی می‌سازد
 */
function getStructuredBrief(brief: any): string {
    if (!brief || !brief.headers || !brief.rowData) return "";
    let structuredBrief = "";
    for (let i = 0; i < brief.headers.length; i++) {
        structuredBrief += `- ${brief.headers[i] || 'ستون خالی'}: ${brief.rowData[i] || 'داده خالی'}\n`;
    }
    return structuredBrief;
}

// =================================================================
// منطق اصلی Worker
// =================================================================

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

                // --- وظیفه ۱: بررسی لاگین کاربر ---
                if (body.task === 'login') {
                    const { username, password } = body;
                    if (!username || !password) throw new Error("نام کاربری یا رمز عبور ارسال نشده است.");
                    
                    const storedPassword = await env.USERS.get(username);
                    if (storedPassword === null) throw new Error("کاربری با این نام یافت نشد.");

                    if (storedPassword === password) {
                        return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }});
                    } else {
                        throw new Error("رمز عبور اشتباه است.");
                    }
                }
                
                // --- وظیفه ۲: دریافت پیشنهاد عنوان ---
                if (body.task === 'get_title_suggestions') {
                    const topic = findInBrief(body.brief, ['topic', 'عنوان', 'موضوع']);
                    if (!topic) throw new Error("ستون موضوع اصلی (topic/عنوان/موضوع) در فایل شما یافت نشد.");

                    const searchUrl = `https://www.googleapis.com/customsearch/v1?key=${env.GOOGLE_API_KEY}&cx=${env.GOOGLE_CSE_ID}&q=${encodeURIComponent(topic)}&num=5&gl=ir&hl=fa`;
                    const searchResponse = await fetch(searchUrl);
                    if (!searchResponse.ok) throw new Error(`خطا در ارتباط با Google Search API`);
                    
                    const searchData: any = await searchResponse.json();
                    const topTitles = searchData.items?.map((item: any) => item.title) || [];
                    if (topTitles.length === 0) throw new Error("هیچ عنوانی از طریق جستجوی گوگل یافت نشد.");

                    const titlePrompt = `Based on the main topic "${topic}" and top 5 Google titles:\n${topTitles.join('\n')}\nSuggest one new, SEO-optimized title. Return only the title text.`;
                    
                    const geminiResponse = await fetch(GEMINI_API_URL, { body: JSON.stringify({ contents: [{ parts: [{ text: titlePrompt }] }] }), headers: { 'Content-Type': 'application/json' }, method: 'POST' });
                    if (!geminiResponse.ok) { const errorText = await geminiResponse.text(); throw new Error(`خطا در ارتباط با Gemini API: ${errorText}`);}
                    
                    const geminiData: any = await geminiResponse.json();
                    const aiSuggestedTitle = geminiData.candidates?.[0]?.content.parts?.[0]?.text || "پاسخی از Gemini دریافت نشد.";
                    
                    return new Response(JSON.stringify({ original_topic: topic, source_titles: topTitles, ai_suggested_title: aiSuggestedTitle.trim() }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }});
                }
                // --- وظیفه ۳: تولید سرفصل ---
                else if (body.task === 'generate_outline') {
                    const { final_title, top_titles, brief } = body;
                    if (!final_title || !top_titles || !brief) throw new Error("اطلاعات لازم برای تولید سرفصل ناقص است.");
                    
                    const structuredBrief = getStructuredBrief(brief);
                    const word_count = findInBrief(brief, ['word', 'count', 'کلمات', 'تعداد']) || 1500;
                    
                    const outlinePrompt = `You are an expert SEO content strategist. Create a comprehensive blog post outline in Persian. CONTEXT: - Final Title: "${final_title}" - Brief: \n${structuredBrief} - Competing Titles: \n${top_titles.join('\n')} INSTRUCTIONS: - Generate a detailed outline using Persian Markdown headings (##, ###). - The outline must support an article of ~${word_count} words. - Return ONLY the Markdown outline.`;
                    
                    const geminiResponse = await fetch(GEMINI_API_URL, { body: JSON.stringify({ contents: [{ parts: [{ text: outlinePrompt }] }] }), headers: { 'Content-Type': 'application/json' }, method: 'POST' });
                    if (!geminiResponse.ok) throw new Error(`خطا در ارتباط با Gemini API برای تولید سرفصل`);
                    
                    const geminiData: any = await geminiResponse.json();
                    const generatedOutline = geminiData.candidates?.[0]?.content.parts?.[0]?.text || "پاسخی برای سرفصل از Gemini دریافت نشد.";
                    
                    return new Response(JSON.stringify({ generated_outline: generatedOutline }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }});
                }
                // --- وظیفه ۴: اصلاح سرفصل ---
                else if (body.task === 'refine_outline') {
                    const { final_title, outline, refinement_prompt, brief } = body;
                    if (!final_title || !outline || !refinement_prompt || !brief) throw new Error("اطلاعات لازم برای اصلاح سرفصل ناقص است.");

                    const structuredBrief = getStructuredBrief(brief);

                    const refinePrompt = `You are an expert content editor. A first draft of a blog post outline has been generated. The user has provided feedback to refine it. CONTEXT: - Final Title: "${final_title}" - Original Brief: \n${structuredBrief} - THE ORIGINAL OUTLINE (Version 1):\n---\n${outline}\n--- USER'S INSTRUCTIONS FOR REFINEMENT:\n---\n"${refinement_prompt}"\n--- YOUR TASK: - Read the original outline and the user's instructions carefully. - Generate a NEW AND IMPROVED outline that incorporates the user's feedback. - The new outline must still be in Persian and use Markdown headings (## for H2, ### for H3). - Return ONLY the new, complete Markdown outline. Do not add any other commentary.`;
                    
                    const geminiResponse = await fetch(GEMINI_API_URL, { body: JSON.stringify({ contents: [{ parts: [{ text: refinePrompt }] }] }), headers: { 'Content-Type': 'application/json' }, method: 'POST' });
                    if (!geminiResponse.ok) throw new Error(`خطا در ارتباط با Gemini API برای اصلاح سرفصل`);
                    
                    const geminiData: any = await geminiResponse.json();
                    const refinedOutline = geminiData.candidates?.[0]?.content.parts?.[0]?.text || "پاسخی برای اصلاح سرفصل از Gemini دریافت نشد.";

                    return new Response(JSON.stringify({ generated_outline: refinedOutline }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }});
                }
                // --- وظیفه ۵: تولید مقاله کامل ---
                else if (body.task === 'generate_article') {
                    const { final_title, outline, brief } = body;
                    if (!final_title || !outline || !brief) throw new Error("اطلاعات لازم برای تولید مقاله کامل ناقص است.");

                    const structuredBrief = getStructuredBrief(brief);
                    const word_count = findInBrief(brief, ['word', 'count', 'کلمات', 'تعداد']) || 1500;
                    let sourceUrl: string | null = findInBrief(brief, ['url']);

                    let articlePrompt = '';
                    
                    if (sourceUrl && (sourceUrl.startsWith('http://') || sourceUrl.startsWith('https://'))) {
                        console.log(`Source URL found: ${sourceUrl}. Fetching content...`);
                        const response = await fetch(sourceUrl);
                        const htmlContent = await response.text();
                        const oldArticleText = stripHtml(htmlContent);
                        articlePrompt = `You are an expert SEO content rewriter...`; // (پرامپت آپدیت مثل قبل)
                    } else {
                        console.log("No source URL found. Generating new content...");
                        articlePrompt = `You are a professional SEO content writer...`; // (پرامپت تولید جدید مثل قبل)
                    }

                    const geminiResponse = await fetch(GEMINI_API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ parts: [{ text: articlePrompt }] }] }) });
                    if (!geminiResponse.ok) { const errorText = await geminiResponse.text(); throw new Error(`خطا در ارتباط با Gemini API برای تولید مقاله: ${errorText}`); }
                    
                    const geminiData: any = await geminiResponse.json();
                    const generatedArticle = geminiData.candidates?.[0]?.content.parts?.[0]?.text || "پاسخی برای مقاله از Gemini دریافت نشد.";

                    return new Response(JSON.stringify({ generated_article: generatedArticle }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }});
                }
                else {
                    throw new Error("وظیفه نامشخص است.");
                }
            } catch (error: any) {
                console.error("Worker Error:", error.stack);
                return new Response(JSON.stringify({ success: false, error: error.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }});
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