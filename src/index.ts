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
                    const geminiResponse = await fetch(GEMINI_API_URL, { body: JSON.stringify({ contents: [{ parts: [{ text: titlePrompt }] }] }), headers: { 'Content-Type': 'application/json' }, method: 'POST' });
                    if (!geminiResponse.ok) { const errorText = await geminiResponse.text(); throw new Error(`خطا در Gemini API: ${errorText}`);}
                    const geminiData: any = await geminiResponse.json();
                    const aiSuggestedTitle = geminiData.candidates?.[0]?.content.parts?.[0]?.text || "پاسخی از Gemini دریافت نشد.";
                    return new Response(JSON.stringify({ original_topic: topic, source_titles: topTitles, ai_suggested_title: aiSuggestedTitle.trim() }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }});
                }
                else if (body.task === 'generate_outline') {
                    const { final_title, top_titles, brief } = body;
                    if (!final_title || !top_titles || !brief) throw new Error("اطلاعات برای تولید سرفصل ناقص است.");
                    const structuredBrief = getStructuredBrief(brief);
                    const word_count = findInBrief(brief, ['word', 'count', 'کلمات', 'تعداد']) || 1500;
                    const outlinePrompt = `You are an SEO expert. Create a detailed outline in Persian for a blog post. CONTEXT: - Title: "${final_title}" - Brief: \n${structuredBrief} - Competitors: \n${top_titles.join('\n')}. INSTRUCTIONS: Use Persian Markdown (##, ###). The outline must support an article of ~${word_count} words. Return ONLY the Markdown.`;
                    const geminiResponse = await fetch(GEMINI_API_URL, { body: JSON.stringify({ contents: [{ parts: [{ text: outlinePrompt }] }] }), headers: { 'Content-Type': 'application/json' }, method: 'POST' });
                    if (!geminiResponse.ok) throw new Error(`خطا در Gemini API برای تولید سرفصل`);
                    const geminiData: any = await geminiResponse.json();
                    const generatedOutline = geminiData.candidates?.[0]?.content.parts?.[0]?.text || "پاسخی برای سرفصل از Gemini دریافت نشد.";
                    return new Response(JSON.stringify({ generated_outline: generatedOutline }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }});
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

                    if (sourceUrl && (sourceUrl.startsWith('http'))) {
    const response = await fetch(sourceUrl);
    if (!response.ok) throw new Error(`دسترسی به URL برای آپدیت ممکن نبود: ${sourceUrl}`);
    const htmlContent = await response.text();
    const oldArticleText = stripHtml(htmlContent);

    articlePrompt = `
        You are an expert SEO content rewriter. Your task is to update and refresh an existing article in PERSIAN based on the provided plan.

        **Provided Plan & Context:**
        1. Final Approved Title: "${final_title}"
        2. Content Brief: \n${structuredBrief}
        3. The Exact Outline to Follow: \n${outline}
        4. The text of the OLD article to avoid repeating: \n${oldArticleText.substring(0, 6000)}

        **CRITICAL WRITING DIRECTIVES:**
        1.  **Adhere to E-E-A-T & Helpful Content:** Write for people, not search engines. The content must be reliable, satisfying, and demonstrate first-hand experience. Get directly to the point for each heading and avoid fluff.
        2.  **Strict Structural Rules:**
            - The Introduction MUST be between **100-150 words**.
            - After each ## H2 heading, you MUST write an introductory paragraph (**50-100 words**) about that topic before its ### H3 subheadings.
            - Each ### H3 section should be between **50-150 words**.
            - The Conclusion MUST be between **100-150 words**.
        3.  **Brand Mention:** You MUST naturally mention the brand name "${brand_name || ''}" at least twice in the article, only if a brand name is provided in the brief.
        4.  **FAQ Section:** Conclude the article with a "Frequently Asked Questions" section (## سوالات متداول) containing exactly **${faq_count}** relevant questions and answers.
        5.  **Word Count:** The final article MUST BE AT LEAST **${word_count} WORDS**.
        6.  **Output Format:** Return ONLY the full text of the article in Persian Markdown. Do not include any meta-commentary, self-reflection, or notes.
    `;
} else {
    console.log("No source URL found. Generating new content...");
    articlePrompt = `
        You are a professional SEO content writer. Your task is to write a complete, comprehensive, and engaging blog post in PERSIAN based on the provided plan.

        **Provided Plan & Context:**
        1. Final Approved Title: "${final_title}"
        2. Content Brief: \n${structuredBrief}
        3. The Exact Outline to Follow: \n${outline}

        **CRITICAL WRITING DIRECTIVES:**
        1.  **Adhere to E-E-A-T & Helpful Content:** Write for people, not search engines. The content must be reliable, satisfying, and demonstrate first-hand experience. Get directly to the point for each heading and avoid fluff.
        2.  **Strict Structural Rules:**
            - The Introduction MUST be between **100-150 words**.
            - After each ## H2 heading, you MUST write an introductory paragraph (**50-100 words**) about that topic before its ### H3 subheadings.
            - Each ### H3 section should be between **50-150 words**.
            - The Conclusion MUST be between **100-150 words**.
        3.  **Brand Mention:** You MUST naturally mention the brand name "${brand_name || ''}" at least twice in the article, only if a brand name is provided in the brief.
        4.  **FAQ Section:** Conclude the article with a "Frequently Asked Questions" section (## سوالات متداول) containing exactly **${faq_count}** relevant questions and answers.
        5.  **Word Count:** YOU MUST WRITE AN ARTICLE OF AT LEAST **${word_count} WORDS**.
        6.  **Output Format:** Return ONLY the full text of the article in Persian Markdown. Do not include any meta-commentary, self-reflection, or notes.
    `;
}
                    const geminiResponse = await fetch(GEMINI_API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ parts: [{ text: articlePrompt }] }] }) });
                    if (!geminiResponse.ok) { const errorText = await geminiResponse.text(); throw new Error(`خطا در Gemini API برای تولید مقاله: ${errorText}`); }
                    const geminiData: any = await geminiResponse.json();
                    const generatedArticle = geminiData.candidates?.[0]?.content.parts?.[0]?.text || "پاسخی برای مقاله از Gemini دریافت نشد.";
                    return new Response(JSON.stringify({ generated_article: generatedArticle }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }});
                }
                else {
                    throw new Error("وظیفه نامشخص است.");
                }

            } catch (error: any) {
                console.error("Worker Error:", error.stack);
                return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }});
            }
        }
        return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
    },
};

interface Env {
    GEMINI_API_KEY: string;
    GOOGLE_API_KEY: string;
    GOOGLE_CSE_ID: string;
}