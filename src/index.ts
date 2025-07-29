// یک تابع کمکی ساده برای پاک‌سازی HTML و تبدیل آن به متن خام
function stripHtml(html: string): string {
    let clean = html.replace(/<script[^>]*>([\S\s]*?)<\/script>/gmi, '');
    clean = clean.replace(/<style[^>]*>([\S\s]*?)<\/style>/gmi, '');
    clean = clean.replace(/<\/div>/ig, '\n');
    clean = clean.replace(/<\/li>/ig, '\n');
    clean = clean.replace(/<li>/ig, '  * ');
    clean = clean.replace(/<\/ul>/ig, '\n');
    clean = clean.replace(/<\/p>/ig, '\n');
    clean = clean.replace(/<br\s*[\/]?>/gi, '\n');
    clean = clean.replace(/<[^>]+>/ig, '');
    clean = clean.replace(/(\r\n|\n|\r){2,}/gm, '\n').trim();
    return clean;
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
                const body: { task?: string; brief?: any; top_titles?: string[]; final_title?: string; outline?: string; } = await request.json();
                const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${env.GEMINI_API_KEY}`;

                const findInBrief = (keys: string[]) => {
                    if (!body.brief || !body.brief.headers || !body.brief.rowData) return null;
                    for (let i = 0; i < body.brief.headers.length; i++) {
                        const header = body.brief.headers[i];
                        if (header && typeof header === 'string') {
                            const lowerHeader = header.toLowerCase();
                            for (const key of keys) {
                                if (lowerHeader.includes(key)) {
                                    return body.brief.rowData[i];
                                }
                            }
                        }
                    }
                    return null;
                };

                const getStructuredBrief = () => {
                    if (!body.brief || !body.brief.headers || !body.brief.rowData) return "";
                    let structuredBrief = "";
                    for (let i = 0; i < body.brief.headers.length; i++) {
                        structuredBrief += `- ${body.brief.headers[i] || 'ستون خالی'}: ${body.brief.rowData[i] || 'داده خالی'}\n`;
                    }
                    return structuredBrief;
                };

                if (body.task === 'get_title_suggestions') {
                    const topic = findInBrief(['topic', 'عنوان', 'موضوع']);
                    if (!topic) throw new Error("ستون موضوع اصلی (topic/عنوان/موضوع) در فایل شما یافت نشد.");

                    const searchUrl = `https://www.googleapis.com/customsearch/v1?key=${env.GOOGLE_API_KEY}&cx=${env.GOOGLE_CSE_ID}&q=${encodeURIComponent(topic)}&num=5&gl=ir&hl=fa`;
                    const searchResponse = await fetch(searchUrl);
                    if (!searchResponse.ok) throw new Error(`خطا در ارتباط با Google Search API`);
                    
                    const searchData: any = await searchResponse.json();
                    const topTitles = searchData.items?.map((item: any) => item.title) || [];
                    if (topTitles.length === 0) throw new Error("هیچ عنوانی از طریق جستجوی گوگل یافت نشد.");

                    const titlePrompt = `Based on the main topic "${topic}" and top 5 Google titles:\n${topTitles.join('\n')}\nSuggest one new, SEO-optimized title. Return only the title text.`;
                    
                    const geminiResponse = await fetch(GEMINI_API_URL, { body: JSON.stringify({ contents: [{ parts: [{ text: titlePrompt }] }] }), headers: { 'Content-Type': 'application/json' }, method: 'POST' });
                    if (!geminiResponse.ok) throw new Error(`خطا در ارتباط با Gemini API`);

                    const geminiData: any = await geminiResponse.json();
                    const aiSuggestedTitle = geminiData.candidates[0].content.parts[0].text;
                    
                    return new Response(JSON.stringify({ original_topic: topic, source_titles: topTitles, ai_suggested_title: aiSuggestedTitle.trim() }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }});
                }
                else if (body.task === 'generate_outline') {
                    const { final_title, top_titles } = body;
                    if (!final_title || !top_titles) throw new Error("اطلاعات لازم برای تولید سرفصل ناقص است.");
                    
                    const structuredBrief = getStructuredBrief();
                    const word_count = findInBrief(['word', 'count', 'کلمات', 'تعداد']) || 1500;
                    
                    const outlinePrompt = `You are an expert SEO content strategist. Create a comprehensive blog post outline in Persian. CONTEXT: - Final Title: "${final_title}" - Brief: \n${structuredBrief} - Competing Titles: \n${top_titles.join('\n')} INSTRUCTIONS: - Generate a detailed outline using Persian Markdown headings (##, ###). - The outline must support an article of ~${word_count} words. - Return ONLY the Markdown outline.`;
                    
                    const geminiResponse = await fetch(GEMINI_API_URL, { body: JSON.stringify({ contents: [{ parts: [{ text: outlinePrompt }] }] }), headers: { 'Content-Type': 'application/json' }, method: 'POST' });
                    if (!geminiResponse.ok) throw new Error(`خطا در ارتباط با Gemini API برای تولید سرفصل`);
                    const geminiData: any = await geminiResponse.json();
                    const generatedOutline = geminiData.candidates[0].content.parts[0].text;
                    return new Response(JSON.stringify({ generated_outline: generatedOutline }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }});
                }
                // --- این بخش به طور کامل با منطق جدید و قوانین شما بازنویسی شده است ---
                else if (body.task === 'generate_article') {
                    const { final_title, outline } = body;
                    if (!final_title || !outline) throw new Error("اطلاعات لازم برای تولید مقاله کامل ناقص است.");

                    const structuredBrief = getStructuredBrief();
                    const word_count = findInBrief(['word', 'count', 'کلمات', 'تعداد']) || 1500;
                    let sourceUrl: string | null = null;
                    if (body.brief && body.brief.rowData) {
                        for (const data of body.brief.rowData) {
                            if (data && typeof data === 'string' && (data.startsWith('http://') || data.startsWith('https://'))) {
                                sourceUrl = data;
                                break;
                            }
                        }
                    }

                    let articlePrompt = '';
                    
                    if (sourceUrl) {
                        // **حالت آپدیت محتوا**
                        console.log(`Source URL found: ${sourceUrl}. Fetching content...`);
                        const response = await fetch(sourceUrl);
                        if (!response.ok) throw new Error(`دسترسی به URL برای آپدیت ممکن نبود: ${sourceUrl}`);
                        const htmlContent = await response.text();
                        const oldArticleText = stripHtml(htmlContent);

                        articlePrompt = `
                            You are an expert SEO content rewriter. Your task is to update and refresh an existing article in PERSIAN.
                            
                            CONTEXT:
                            1. Final Approved Title: "${final_title}"
                            2. Content Brief: \n${structuredBrief}
                            3. New Outline to Follow: \n${outline}
                            4. IMPORTANT: The text of the OLD article is below:
                               ---
                               ${oldArticleText.substring(0, 8000)}
                               ---

                            CRITICAL INSTRUCTIONS:
                            - Write a NEW and IMPROVED version of the article, avoiding duplicate content from the old text.
                            - **The Introduction MUST be between 100-150 words.**
                            - **After each H2 heading, you MUST write an introductory paragraph (50-100 words) about that topic before starting its H3 subheadings.** This is a mandatory rule.
                            - **The final article MUST BE AT LEAST ${word_count} words.**
                            - You MUST follow the new outline precisely.
                            - Write in fluent, engaging Persian.
                            - Return ONLY the full text of the article in Markdown.
                        `;
                    } else {
                        // **حالت تولید محتوای جدید**
                        console.log("No source URL found. Generating new content...");
                        articlePrompt = `
                            You are a professional SEO content writer. Your task is to write a complete, comprehensive, and engaging blog post in PERSIAN.
                            
                            ALL INFORMATION PROVIDED:
                            1. Final Approved Title: "${final_title}"
                            2. Content Brief: \n${structuredBrief}
                            3. The exact Outline to follow: \n${outline}

                            CRITICAL INSTRUCTIONS:
                            - **The Introduction MUST be between 100-150 words.**
                            - **After each H2 heading, you MUST write an introductory paragraph (50-100 words) about that topic before starting its H3 subheadings.** This is a mandatory rule.
                            - **YOU MUST WRITE AN ARTICLE OF AT LEAST ${word_count} WORDS.**
                            - You MUST follow the provided outline precisely.
                            - Write in fluent, natural, and engaging Persian with short paragraphs.
                            - Return ONLY the full text of the article in Markdown format.
                        `;
                    }

                    const geminiResponse = await fetch(GEMINI_API_URL, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ contents: [{ parts: [{ text: articlePrompt }] }] })
                    });
                     if (!geminiResponse.ok) {
                        const errorText = await geminiResponse.text();
                        throw new Error(`خطا در ارتباط با Gemini API برای تولید مقاله: ${errorText}`);
                     }

                    const geminiData: any = await geminiResponse.json();
                    const generatedArticle = geminiData.candidates[0].content.parts[0].text;
                    return new Response(JSON.stringify({ generated_article: generatedArticle }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }});
                }
                else {
                    throw new Error("وظیفه نامشخص است.");
                }
            } catch (error: any) {
                console.error("Fatal Error in worker:", error);
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